// src/commands/topic.ts
// CLI command for topic management: add, list, remove.

import { loadConfig } from "../config.js";
import { addTopic, removeTopic, listTopicsWithMetadata, coldStartTopic } from "../knowledge-page.js";
import type { TopicSource } from "../types.js";

export async function topicCommand(
  subcommand: string,
  args: string[],
  opts: Record<string, any>
): Promise<void> {
  const config = await loadConfig(opts);
  const json = opts.json ?? false;

  switch (subcommand) {
    case "add": {
      const slug = args[0];
      if (!slug) {
        const msg = "Topic slug is required";
        if (json) console.log(JSON.stringify({ success: false, error: msg }));
        else console.error(msg);
        return;
      }
      const name = opts.name || slug;
      const description = opts.description || "";
      const source: TopicSource = opts.source || "user";

      const result = await addTopic(slug, name, description, source, config);

      if (result.added && description) {
        // Run cold-start to find related content
        const coldStart = await coldStartTopic(slug, description, config);
        if (json) {
          console.log(JSON.stringify({ success: true, ...result, coldStartSuggestions: coldStart.suggestions }));
        } else {
          console.log(`Added topic: ${slug}`);
          if (coldStart.suggestions.length > 0) {
            console.log(`\nFound ${coldStart.suggestions.length} related content suggestions:`);
            for (const s of coldStart.suggestions.slice(0, 5)) {
              console.log(`  [${(s.similarity * 100).toFixed(0)}%] ${s.type}: ${s.snippet.slice(0, 80)}...`);
            }
            console.log("\nSuggestions written to review queue.");
          } else {
            console.log("No related content found (cold-start).");
          }
        }
      } else if (json) {
        console.log(JSON.stringify({ success: result.added, ...result }));
      } else {
        console.log(result.reason);
      }
      break;
    }

    case "list": {
      const topics = await listTopicsWithMetadata(config);
      if (json) {
        console.log(JSON.stringify({ success: true, topics }));
      } else {
        if (topics.length === 0) {
          console.log("No topics defined yet.");
          return;
        }
        console.log(`Topics (${topics.length}):\n`);
        for (const t of topics) {
          const sections = t.sectionCount > 0 ? `${t.sectionCount} sections, ${t.wordCount} words` : "no content yet";
          const updated = t.lastUpdated ? `, updated ${t.lastUpdated}` : "";
          console.log(`  ${t.topic.slug} [${t.topic.source}] — ${t.topic.name}`);
          console.log(`    ${sections}${updated}`);
          if (t.topic.description) {
            console.log(`    ${t.topic.description.slice(0, 80)}`);
          }
          console.log();
        }
      }
      break;
    }

    case "remove": {
      const slug = args[0];
      if (!slug) {
        const msg = "Topic slug is required";
        if (json) console.log(JSON.stringify({ success: false, error: msg }));
        else console.error(msg);
        return;
      }

      const result = await removeTopic(slug, config, { force: opts.force });
      if (json) {
        console.log(JSON.stringify({ success: result.removed, ...result }));
      } else {
        console.log(result.reason);
      }
      break;
    }

    default: {
      const msg = `Unknown topic subcommand: ${subcommand}. Use add, list, or remove.`;
      if (json) console.log(JSON.stringify({ success: false, error: msg }));
      else console.error(msg);
    }
  }
}
