// src/knowledge-gen.ts
// Generate a knowledge page on-demand when a user approves a topic.
// Searches session notes + FTS for ALL relevant content (bounded by LLM context
// window, not arbitrary snippet counts), deduplicates by source, then makes an
// LLM call to produce organized sub-page content.

import { Config, Topic } from "./types.js";
import {
  createTopicDirectory,
  writeKnowledgePage,
  listSubPages,
  loadKnowledgePage,
  type ParsedKnowledgePage,
} from "./knowledge-page.js";
import { openSearchIndex } from "./search.js";
import { log, warn, expandPath } from "./utils.js";
import { generateObjectSafe, configForStep } from "./llm.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";

// Content budget — conservative to stay under API rate limits.
// Most plans have 30K-60K input token/min limits, so we cap at ~20K tokens of content
// to leave room for the prompt overhead and avoid rate limit errors.
const MAX_CONTENT_CHARS = 80_000; // ~20K tokens at ~4 chars/token

const KnowledgeGenOutputSchema = z.object({
  sections: z.array(z.object({
    sub_page: z.string().default("_index"),
    section_title: z.string().min(1),
    content: z.string().min(1),
    confidence: z.enum(["verified", "inferred", "uncertain"]),
  })),
});

const KNOWLEDGE_GEN_PROMPT = `You are generating a comprehensive knowledge page for a topic in a developer's knowledge base.

<topic>
Name: {topicName}
Description: {topicDescription}
</topic>

<sub_pages>
{subPages}
</sub_pages>

<relevant_content>
{relevantContent}
</relevant_content>

Based on ALL the relevant content above, generate a thorough set of knowledge sections for this topic.

INSTRUCTIONS:
- Synthesize information across multiple sessions — combine related facts, don't just repeat each session verbatim
- Deduplicate: if the same fact appears in multiple sessions, write it once with higher confidence
- Route each section to the most appropriate sub-page based on its description
- Use "_index" for the topic's main overview page if no sub-page fits
- Write detailed, factual prose (3-8 sentences per section) with specific details: paths, configs, error messages, commands, code patterns
- Set confidence: "verified" (confirmed in multiple sessions or explicitly tested), "inferred" (reasonable conclusion from one session), "uncertain" (ambiguous or contradictory)
- Cover everything substantive — the goal is a comprehensive reference for this topic
- Organize logically: group related information into sections with clear headings
- Skip only truly ephemeral details (local env state, temporary debug output)`;

interface RankedContent {
  source: string;     // e.g. "session-abc123" or "fts:knowledge"
  text: string;
  score: number;
  charCount: number;
}

/**
 * Generate a knowledge page for a newly approved topic.
 * Gathers ALL relevant content (bounded by context window), deduplicates by
 * source session, and uses an LLM to produce organized sections.
 */
export async function generateKnowledgePage(
  topic: Topic,
  config: Config
): Promise<{ sectionsGenerated: number }> {
  log(`Generating knowledge page for topic "${topic.slug}"...`);

  // 1. Gather ALL relevant content
  const allContent: RankedContent[] = [];
  const seenSources = new Set<string>();

  // 1a. FTS search — get as many results as possible
  try {
    const idx = openSearchIndex(config.searchDbPath);
    const hits = idx.search(topic.name + " " + topic.description, { limit: 100 });
    for (const hit of hits) {
      const sourceKey = `fts:${hit.table}:${hit.id}`;
      if (seenSources.has(sourceKey)) continue;
      seenSources.add(sourceKey);
      allContent.push({
        source: sourceKey,
        text: `[${hit.table}] ${hit.snippet}`,
        score: 1 / (1 + Math.abs(hit.rank)),
        charCount: hit.snippet.length,
      });
    }
    idx.close();
  } catch {
    // No search index
  }

  // 1b. Session notes — full body text for matching notes
  const notesDir = expandPath(config.sessionNotesDir);

  // Filter out generic stop words that match everything
  const STOP_WORDS = new Set([
    "patterns", "practices", "designing", "building", "using", "working",
    "managing", "handling", "processing", "systems", "architecture",
    "approaches", "techniques", "strategies", "methods", "including",
    "regarding", "information", "anything", "related", "about"
  ]);
  const searchTerms = (topic.name + " " + topic.description)
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 3 && !STOP_WORDS.has(t));

  // Need at least some specific terms to search
  if (searchTerms.length === 0) {
    // Fall back to using topic name words only
    searchTerms.push(...topic.name.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  }

  try {
    const files = await fs.readdir(notesDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const noteId = file.replace(".md", "");
      if (seenSources.has(`note:${noteId}`)) continue;

      try {
        const raw = await fs.readFile(path.join(notesDir, file), "utf-8");

        // Strip frontmatter for matching
        const bodyMatch = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
        const body = bodyMatch ? bodyMatch[1] : raw;
        const lower = body.toLowerCase();

        // Score by specific keyword match density
        const matchCount = searchTerms.filter(t => lower.includes(t)).length;
        const matchRatio = matchCount / searchTerms.length;
        if (matchCount < 2 || matchRatio < 0.3) continue;

        seenSources.add(`note:${noteId}`);
        allContent.push({
          source: `note:${noteId}`,
          text: `[session_note: ${noteId}]\n${body}`,
          score: matchRatio,
          charCount: body.length,
        });
      } catch { /* skip */ }
    }
  } catch { /* no dir */ }

  if (allContent.length === 0) {
    log(`No relevant content found for topic "${topic.slug}" — creating empty page`);
    await createTopicDirectory(topic, config);
    return { sectionsGenerated: 0 };
  }

  // 2. Rank and fill context budget
  // Strategy: FTS snippets first (pre-extracted relevant fragments),
  // then session note bodies (full context but large).
  // Within each group, sort by score descending.
  const ftsContent = allContent.filter(c => c.source.startsWith("fts:")).sort((a, b) => b.score - a.score);
  const noteContent = allContent.filter(c => c.source.startsWith("note:")).sort((a, b) => b.score - a.score);
  const ranked = [...ftsContent, ...noteContent];

  const selectedContent: string[] = [];
  let totalChars = 0;
  // Cap individual items to prevent one giant note from consuming the whole budget
  const MAX_ITEM_CHARS = Math.min(MAX_CONTENT_CHARS / 2, 40_000);

  for (const item of ranked) {
    const itemText = item.charCount > MAX_ITEM_CHARS
      ? item.text.slice(0, MAX_ITEM_CHARS) + "\n[... truncated]"
      : item.text;
    const itemChars = Math.min(item.charCount, MAX_ITEM_CHARS);

    if (totalChars + itemChars > MAX_CONTENT_CHARS) {
      const remaining = MAX_CONTENT_CHARS - totalChars;
      if (remaining > 2000) {
        selectedContent.push(item.text.slice(0, remaining) + "\n[... truncated]");
        totalChars += remaining;
      }
      break;
    }
    selectedContent.push(itemText);
    totalChars += itemChars;
  }

  log(`Gathered ${selectedContent.length} content pieces (${Math.round(totalChars / 1000)}K chars) for topic "${topic.slug}"`);

  // 3. Format sub-pages for the prompt
  const subPagesText = topic.subpages && topic.subpages.length > 0
    ? topic.subpages.map(sp => `- ${sp.slug}: ${sp.name} — ${sp.description}`).join("\n")
    : "(No sub-pages defined. Use _index for all content.)";

  // 4. LLM call to generate organized sections
  const prompt = KNOWLEDGE_GEN_PROMPT
    .replace("{topicName}", topic.name)
    .replace("{topicDescription}", topic.description)
    .replace("{subPages}", subPagesText)
    .replace("{relevantContent}", selectedContent.join("\n\n---\n\n"));

  let output: z.infer<typeof KnowledgeGenOutputSchema>;
  try {
    output = await generateObjectSafe(KnowledgeGenOutputSchema, prompt, configForStep(config, "knowledgeGen"));
  } catch (err) {
    warn(`LLM call failed for topic "${topic.slug}": ${err}`);
    await createTopicDirectory(topic, config);
    return { sectionsGenerated: 0 };
  }

  // 5. Create the topic directory and write sections
  // Check if directory already exists (approval may have created it)
  const existingSubPages = await listSubPages(topic.slug, config);
  if (existingSubPages.length === 0) {
    await createTopicDirectory(topic, config);
  }

  const today = new Date().toISOString().split("T")[0];
  const pagesBySubPage = new Map<string, ParsedKnowledgePage>();

  for (const section of output.sections) {
    const sub = section.sub_page || "_index";

    if (!pagesBySubPage.has(sub)) {
      // Load existing page or create new one
      const existing = await loadKnowledgePage(topic.slug, config, sub);
      if (existing) {
        pagesBySubPage.set(sub, existing);
      } else {
        const spDef = topic.subpages?.find(sp => sp.slug === sub);
        pagesBySubPage.set(sub, {
          frontmatter: {
            topic: spDef?.name || topic.name,
            description: spDef?.description || topic.description,
            source: topic.source,
            created: today,
            last_updated: today,
          },
          sections: [],
          raw: "",
        });
      }
    }

    const page = pagesBySubPage.get(sub)!;
    const sectionId = `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    page.sections.push({
      id: sectionId,
      title: section.section_title,
      content: section.content,
      confidence: section.confidence,
      source: "knowledge-gen",
      added: today,
      related_bullets: [],
    });
  }

  // Write all sub-pages
  for (const [sub, page] of pagesBySubPage) {
    page.frontmatter.last_updated = today;
    await writeKnowledgePage(topic.slug, page, config, sub);
    log(`Wrote ${page.sections.length} sections to ${topic.slug}/${sub}`);
  }

  log(`Knowledge generation complete for "${topic.slug}": ${output.sections.length} sections`);
  return { sectionsGenerated: output.sections.length };
}
