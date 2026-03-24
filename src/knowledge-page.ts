// src/knowledge-page.ts
// Knowledge page file I/O: parse/serialize markdown files with HTML comment metadata.
// Knowledge pages are the source of truth; SQLite is the derived search index.

import path from "node:path";
import fs from "node:fs/promises";
import {
  Config,
  KnowledgePage,
  KnowledgePageSection,
  ParsedKnowledgePage,
  KnowledgePageAppendDelta,
  TopicsFile,
  TopicsFileSchema,
  Topic,
  TopicSource,
  ConfidenceTier,
  ReviewQueueItem,
} from "./types.js";
import { expandPath, ensureDir, atomicWrite, log, warn } from "./utils.js";
import { withLock } from "./lock.js";
import { appendReviewItems } from "./review-queue.js";

// ============================================================================
// PARSING
// ============================================================================

/** Regex for section heading (## Title) */
const HEADING_RE = /^#{2}\s+(.+)$/;

/** Regex for metadata HTML comment */
const META_COMMENT_RE = /^<!--\s*(.+?)\s*-->$/;

/** Parse a pipe-delimited HTML comment into key-value pairs. */
function parseMetaComment(line: string): Record<string, string> | null {
  const match = line.match(META_COMMENT_RE);
  if (!match) return null;

  const pairs: Record<string, string> = {};
  for (const segment of match[1].split(" | ")) {
    const colonIdx = segment.indexOf(":");
    if (colonIdx === -1) continue;
    const key = segment.slice(0, colonIdx).trim();
    const value = segment.slice(colonIdx + 1).trim();
    if (key && value) pairs[key] = value;
  }
  return pairs;
}

/**
 * Parse a knowledge page markdown file into frontmatter + sections.
 * Handles the HTML comment metadata format with 3-line lookahead.
 */
export function parseKnowledgePage(raw: string): ParsedKnowledgePage {
  // Split frontmatter from body
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error("Knowledge page missing YAML frontmatter");
  }

  const fmRaw = fmMatch[1];
  const body = fmMatch[2];

  // Parse YAML frontmatter (simple key-value, matching session-notes.ts pattern)
  const frontmatter: Record<string, any> = {};
  for (const line of fmRaw.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  const fm: KnowledgePage = {
    topic: frontmatter.topic || "",
    description: frontmatter.description || "",
    source: (frontmatter.source as "user" | "system") || "system",
    created: frontmatter.created || new Date().toISOString().split("T")[0],
    last_updated: frontmatter.last_updated || new Date().toISOString().split("T")[0],
  };

  // Parse sections from body
  const sections: KnowledgePageSection[] = [];
  const lines = body.split("\n");
  let i = 0;

  while (i < lines.length) {
    const headingMatch = lines[i].match(HEADING_RE);
    if (!headingMatch) {
      i++;
      continue;
    }

    const title = headingMatch[1].trim();
    i++;

    // Scan forward up to 3 lines for metadata comment (handles blank lines)
    let meta: Record<string, string> | null = null;
    let metaLineIdx = -1;
    for (let lookahead = 0; lookahead < 3 && i + lookahead < lines.length; lookahead++) {
      const candidate = lines[i + lookahead].trim();
      if (candidate === "") continue; // skip blank lines
      meta = parseMetaComment(candidate);
      if (meta) {
        metaLineIdx = i + lookahead;
        break;
      }
      break; // Non-blank, non-comment line — stop looking
    }

    if (metaLineIdx >= 0) {
      i = metaLineIdx + 1;
    }

    // Collect content lines until next heading or EOF
    const contentLines: string[] = [];
    while (i < lines.length) {
      if (HEADING_RE.test(lines[i])) break;
      contentLines.push(lines[i]);
      i++;
    }

    // Trim leading/trailing blank lines from content
    const content = contentLines.join("\n").trim();

    sections.push({
      id: meta?.id || "",
      title,
      content,
      confidence: (meta?.confidence as ConfidenceTier) || "uncertain",
      source: meta?.source || "",
      added: meta?.added || "",
      related_bullets: meta?.related_bullets
        ? meta.related_bullets.split(",").map(s => s.trim()).filter(Boolean)
        : [],
    });
  }

  return { frontmatter: fm, sections, raw };
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/** Serialize a section metadata comment. */
function serializeMetaComment(section: KnowledgePageSection): string {
  const parts = [
    `id: ${section.id}`,
    `confidence: ${section.confidence}`,
    `source: ${section.source}`,
    `added: ${section.added}`,
  ];
  if (section.related_bullets.length > 0) {
    parts.push(`related_bullets: ${section.related_bullets.join(",")}`);
  }
  return `<!-- ${parts.join(" | ")} -->`;
}

/** Serialize YAML frontmatter for a knowledge page. */
function serializeFrontmatter(fm: KnowledgePage): string {
  return [
    "---",
    `topic: ${fm.topic}`,
    `description: "${fm.description}"`,
    `source: ${fm.source}`,
    `created: ${fm.created}`,
    `last_updated: ${fm.last_updated}`,
    "---",
  ].join("\n");
}

/** Serialize a full knowledge page to markdown. */
export function serializeKnowledgePage(page: ParsedKnowledgePage): string {
  const parts: string[] = [serializeFrontmatter(page.frontmatter)];

  for (const section of page.sections) {
    parts.push(""); // blank line before heading
    parts.push(`## ${section.title}`);
    parts.push(serializeMetaComment(section));
    parts.push("");
    parts.push(section.content);
  }

  parts.push(""); // trailing newline
  return parts.join("\n");
}

// ============================================================================
// FILE I/O
// ============================================================================

/** Resolve path for a knowledge page file. */
export function knowledgePagePath(topicSlug: string, config: Config): string {
  return path.join(expandPath(config.knowledgeDir), `${topicSlug}.md`);
}

/** Load and parse a knowledge page. Returns null if file doesn't exist. */
export async function loadKnowledgePage(
  topicSlug: string,
  config: Config
): Promise<ParsedKnowledgePage | null> {
  const filePath = knowledgePagePath(topicSlug, config);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return parseKnowledgePage(raw);
  } catch {
    return null;
  }
}

/** Write a knowledge page with locking + atomic write. */
export async function writeKnowledgePage(
  topicSlug: string,
  page: ParsedKnowledgePage,
  config: Config
): Promise<string> {
  const filePath = knowledgePagePath(topicSlug, config);
  await ensureDir(path.dirname(filePath));
  const content = serializeKnowledgePage(page);
  await withLock(filePath, async () => {
    await atomicWrite(filePath, content);
  });
  return filePath;
}

/**
 * Append a section to a knowledge page. Creates the page if it doesn't exist.
 * Uses source-session-ID dedup: if a section from the same source session already
 * exists, skip (different sources always kept — user merges via review queue).
 */
export async function appendSectionToPage(
  delta: KnowledgePageAppendDelta,
  topic: Topic | undefined,
  config: Config
): Promise<{ written: boolean; reason: string }> {
  let page = await loadKnowledgePage(delta.topic_slug, config);

  if (!page) {
    // Create new page
    const today = new Date().toISOString().split("T")[0];
    page = {
      frontmatter: {
        topic: topic?.name || delta.topic_slug,
        description: topic?.description || "",
        source: topic?.source || "system",
        created: today,
        last_updated: today,
      },
      sections: [],
      raw: "",
    };
    log(`Creating new knowledge page: ${delta.topic_slug}`);
  }

  // Source-session-ID dedup: same source → skip
  const existingFromSameSource = page.sections.find(
    s => s.source === delta.source_session && s.title === delta.section_title
  );
  if (existingFromSameSource) {
    return {
      written: false,
      reason: `Section "${delta.section_title}" from ${delta.source_session} already exists on ${delta.topic_slug}`,
    };
  }

  // Append section
  const newSection: KnowledgePageSection = {
    id: delta.section_id,
    title: delta.section_title,
    content: delta.content,
    confidence: delta.confidence,
    source: delta.source_session,
    added: delta.added_date,
    related_bullets: delta.related_bullets,
  };

  page.sections.push(newSection);
  page.frontmatter.last_updated = new Date().toISOString().split("T")[0];

  await writeKnowledgePage(delta.topic_slug, page, config);
  log(`Appended section "${delta.section_title}" to ${delta.topic_slug}`);

  return { written: true, reason: "Section appended" };
}

// ============================================================================
// TOPICS.JSON I/O
// ============================================================================

/** Load topics from topics.json. Returns empty array if file doesn't exist. */
export async function loadTopics(config: Config): Promise<Topic[]> {
  const filePath = expandPath(config.topicsJsonPath);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = TopicsFileSchema.parse(JSON.parse(raw));
    return parsed.topics;
  } catch {
    return [];
  }
}

/** Save topics to topics.json with locking + atomic write. */
export async function saveTopics(topics: Topic[], config: Config): Promise<void> {
  const filePath = expandPath(config.topicsJsonPath);
  await ensureDir(path.dirname(filePath));
  const content = JSON.stringify({ topics } satisfies TopicsFile, null, 2);
  await withLock(filePath, async () => {
    await atomicWrite(filePath, content);
  });
}

/** Add a topic suggestion to topics.json if the slug doesn't already exist. */
export async function addTopicSuggestion(
  slug: string,
  name: string,
  description: string,
  suggestedFromSession: string,
  config: Config
): Promise<{ added: boolean; reason: string }> {
  const topics = await loadTopics(config);

  if (topics.some(t => t.slug === slug)) {
    return { added: false, reason: `Topic "${slug}" already exists` };
  }

  topics.push({
    slug,
    name,
    description,
    source: "system",
    created: new Date().toISOString().split("T")[0],
  });

  await saveTopics(topics, config);
  log(`Added topic suggestion: ${slug}`);
  return { added: true, reason: "Topic added" };
}

// ============================================================================
// DIGEST I/O
// ============================================================================

/** Resolve path for a daily digest file. */
export function digestPath(date: string, config: Config): string {
  return path.join(expandPath(config.digestsDir), `${date}.md`);
}

// ============================================================================
// TOPIC CRUD (Phase 4)
// ============================================================================

/**
 * Add a topic (user or system). Returns false if slug already exists.
 */
export async function addTopic(
  slug: string,
  name: string,
  description: string,
  source: TopicSource,
  config: Config
): Promise<{ added: boolean; reason: string }> {
  const topics = await loadTopics(config);

  if (topics.some(t => t.slug === slug)) {
    return { added: false, reason: `Topic "${slug}" already exists` };
  }

  topics.push({
    slug,
    name,
    description,
    source,
    created: new Date().toISOString(),
  });

  await saveTopics(topics, config);
  log(`Added topic: ${slug} (${source})`);
  return { added: true, reason: "Topic added" };
}

/**
 * Remove a topic from topics.json. Only system topics unless force=true.
 * Does NOT delete the knowledge page file (user may want to keep it).
 */
export async function removeTopic(
  slug: string,
  config: Config,
  options?: { force?: boolean }
): Promise<{ removed: boolean; reason: string }> {
  const topics = await loadTopics(config);
  const idx = topics.findIndex(t => t.slug === slug);

  if (idx === -1) {
    return { removed: false, reason: `Topic "${slug}" not found` };
  }

  const topic = topics[idx];
  if (topic.source === "user" && !options?.force) {
    return { removed: false, reason: `Topic "${slug}" is user-created. Use force to remove.` };
  }

  topics.splice(idx, 1);
  await saveTopics(topics, config);
  log(`Removed topic: ${slug}`);
  return { removed: true, reason: "Topic removed" };
}

/**
 * List topics with metadata from knowledge page files.
 */
export async function listTopicsWithMetadata(config: Config): Promise<Array<{
  topic: Topic;
  sectionCount: number;
  lastUpdated: string | null;
  wordCount: number;
}>> {
  const topics = await loadTopics(config);
  const results = [];

  for (const topic of topics) {
    const page = await loadKnowledgePage(topic.slug, config);
    results.push({
      topic,
      sectionCount: page?.sections.length ?? 0,
      lastUpdated: page?.frontmatter.last_updated ?? null,
      wordCount: page ? page.sections.reduce((sum, s) => sum + s.content.split(/\s+/).length, 0) : 0,
    });
  }

  return results;
}

/**
 * Cold-start a new topic: embed its description, find similar content in existing
 * knowledge pages and session notes, write matches to review queue.
 */
export async function coldStartTopic(
  slug: string,
  description: string,
  config: Config
): Promise<{ suggestions: Array<{ type: string; snippet: string; similarity: number }> }> {
  const suggestions: Array<{ type: string; snippet: string; similarity: number; topic?: string; section?: string }> = [];

  try {
    const { embedText, cosineSimilarity } = await import("./semantic.js");
    const descEmbedding = await embedText(description);

    // Search existing knowledge page sections
    const knowledgeDir = expandPath(config.knowledgeDir);
    let knowledgeFiles: string[] = [];
    try {
      knowledgeFiles = (await fs.readdir(knowledgeDir)).filter(f => f.endsWith(".md"));
    } catch {
      // No knowledge dir yet
    }

    for (const file of knowledgeFiles) {
      const topicSlug = file.replace(/\.md$/, "");
      if (topicSlug === slug) continue; // Don't match self

      const raw = await fs.readFile(path.join(knowledgeDir, file), "utf-8");
      try {
        const page = parseKnowledgePage(raw);
        for (const section of page.sections) {
          const sectionEmbedding = await embedText(section.content.slice(0, 500));
          const sim = cosineSimilarity(descEmbedding, sectionEmbedding);
          if (sim >= 0.3) {
            suggestions.push({
              type: "knowledge_section",
              topic: topicSlug,
              section: section.title,
              snippet: section.content.slice(0, 200),
              similarity: sim,
            });
          }
        }
      } catch {
        // Skip malformed knowledge pages
      }
    }

    // Search session notes
    const notesDir = expandPath(config.sessionNotesDir);
    let noteFiles: string[] = [];
    try {
      noteFiles = (await fs.readdir(notesDir)).filter(f => f.endsWith(".md"));
    } catch {
      // No session notes dir yet
    }

    for (const file of noteFiles.slice(0, 20)) { // Cap at 20 most recent
      const raw = await fs.readFile(path.join(notesDir, file), "utf-8");
      // Extract body after frontmatter
      const bodyMatch = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      const body = bodyMatch?.[1]?.trim() || "";
      if (!body) continue;

      const noteEmbedding = await embedText(body.slice(0, 500));
      const sim = cosineSimilarity(descEmbedding, noteEmbedding);
      if (sim >= 0.3) {
        suggestions.push({
          type: "session_note",
          snippet: body.slice(0, 200),
          similarity: sim,
        });
      }
    }

    // Sort by similarity descending, take top 10
    suggestions.sort((a, b) => b.similarity - a.similarity);
    const topSuggestions = suggestions.slice(0, 10);

    // Write to review queue
    if (topSuggestions.length > 0) {
      const reviewItems: ReviewQueueItem[] = topSuggestions.map((s, i) => ({
        id: `rq-${slug}-${Date.now()}-${i}`,
        type: "cold_start_suggestion" as const,
        status: "pending" as const,
        created: new Date().toISOString(),
        target_topic: slug,
        source: {
          type: (s.type === "knowledge_section" ? "knowledge_section" : "session_note") as "knowledge_section" | "session_note",
          topic: s.topic,
          section: s.section,
          snippet: s.snippet,
          similarity: Math.round(s.similarity * 100) / 100,
        },
      }));
      await appendReviewItems(reviewItems, config);
    }

    return { suggestions: topSuggestions };
  } catch (err) {
    warn(`Cold-start failed for topic "${slug}": ${err}`);
    return { suggestions: [] };
  }
}

// ============================================================================
// DIGEST I/O
// ============================================================================

/** Append a session paragraph to a daily digest. Creates the file if needed. */
export async function appendToDigest(
  date: string,
  content: string,
  sessionsCovered: string[],
  config: Config
): Promise<void> {
  const filePath = digestPath(date, config);
  await ensureDir(path.dirname(filePath));

  let existing = "";
  let existingFm: { sessions: number; topics_touched: string[] } = { sessions: 0, topics_touched: [] };

  try {
    existing = await fs.readFile(filePath, "utf-8");
    // Parse existing frontmatter
    const fmMatch = existing.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (fmMatch) {
      for (const line of fmMatch[1].split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key === "sessions") existingFm.sessions = parseInt(value, 10) || 0;
      }
      existing = fmMatch[2];
    }
  } catch {
    // File doesn't exist yet
  }

  const newSessions = existingFm.sessions + sessionsCovered.length;
  const frontmatter = [
    "---",
    `date: ${date}`,
    `sessions: ${newSessions}`,
    `topics_touched: []`,
    "---",
  ].join("\n");

  const body = existing.trim()
    ? `${existing.trim()}\n\n${content.trim()}`
    : content.trim();

  const fullContent = `${frontmatter}\n\n${body}\n`;

  await withLock(filePath, async () => {
    await atomicWrite(filePath, fullContent);
  });
  log(`Updated digest for ${date}`);
}
