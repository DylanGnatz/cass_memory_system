import { describe, it, expect } from "bun:test";
import { withTempCassHome } from "./helpers/temp.js";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import {
  addTopic,
  removeTopic,
  listTopicsWithMetadata,
  loadTopics,
} from "../src/knowledge-page.js";
import {
  loadReviewQueue,
  appendReviewItems,
  dismissReviewItem,
  approveReviewItem,
} from "../src/review-queue.js";

describe("Phase 4 topic management", () => {
  it("addTopic creates a new topic", async () => {
    await withTempCassHome(async (env) => {
      const config = await loadConfig();
      await addTopic("billing", "Billing", "Payment processing", "user", config);
      const topics = await loadTopics(config);
      expect(topics.length).toBe(1);
      expect(topics[0].slug).toBe("billing");
      expect(topics[0].name).toBe("Billing");
      expect(topics[0].source).toBe("user");
    });
  });

  it("addTopic rejects duplicate slugs", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      await addTopic("billing", "Billing", "Payments", "user", config);
      const result = await addTopic("billing", "Billing 2", "More payments", "user", config);
      expect(result.added).toBe(false);
      expect(result.reason).toMatch(/already exists/i);
    });
  });

  it("removeTopic removes system topics", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      await addTopic("temp", "Temp", "Temporary", "system", config);
      const result = await removeTopic("temp", config);
      expect(result.removed).toBe(true);
      const topics = await loadTopics(config);
      expect(topics.length).toBe(0);
    });
  });

  it("removeTopic refuses to remove user topics without force", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      await addTopic("billing", "Billing", "Payments", "user", config);
      const result = await removeTopic("billing", config);
      expect(result.removed).toBe(false);
      expect(result.reason).toMatch(/force/i);
    });
  });

  it("removeTopic removes user topics with force flag", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      await addTopic("billing", "Billing", "Payments", "user", config);
      const result = await removeTopic("billing", config, { force: true });
      expect(result.removed).toBe(true);
      const topics = await loadTopics(config);
      expect(topics.length).toBe(0);
    });
  });

  it("listTopicsWithMetadata returns metadata for topics", async () => {
    await withTempCassHome(async (env) => {
      const config = await loadConfig();
      await addTopic("billing", "Billing", "Payments", "user", config);

      // Write content to the topic directory's _index.md (addTopic already created the directory)
      const knowledgeDir = path.join(env.cassMemoryDir, "knowledge");
      await writeFile(
        path.join(knowledgeDir, "billing", "_index.md"),
        `---
topic: Billing
description: "Payments"
source: user
created: 2026-03-20
last_updated: 2026-03-20
---

## Webhook Validation

Always validate webhook signatures.

## Payment Processing

Process payments asynchronously.
`
      );

      const result = await listTopicsWithMetadata(config);
      expect(result.length).toBe(1);
      expect(result[0].topic.slug).toBe("billing");
      expect(result[0].sectionCount).toBe(2);
      expect(result[0].wordCount).toBeGreaterThan(0);
    });
  });

  it("listTopicsWithMetadata handles topics without knowledge pages", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      await addTopic("billing", "Billing", "Payments", "user", config);

      const result = await listTopicsWithMetadata(config);
      expect(result.length).toBe(1);
      expect(result[0].sectionCount).toBe(0);
      expect(result[0].wordCount).toBe(0);
    });
  });
});

describe("Phase 4 review queue", () => {
  it("loadReviewQueue returns empty queue initially", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      const queue = await loadReviewQueue(config);
      expect(queue.items.length).toBe(0);
    });
  });

  it("appendReviewItems adds items", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      const items = [
        {
          id: "rq-test-1",
          type: "bloated_page" as const,
          status: "pending" as const,
          created: new Date().toISOString(),
          target_topic: "billing",
          data: { word_count: 6000, section_count: 15 },
        },
      ];
      const result = await appendReviewItems(items, config);
      expect(result.added).toBe(1);

      const queue = await loadReviewQueue(config);
      expect(queue.items.length).toBe(1);
      expect(queue.items[0].id).toBe("rq-test-1");
    });
  });

  it("appendReviewItems deduplicates by composite key", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      const item = {
        id: "rq-test-1",
        type: "bloated_page" as const,
        status: "pending" as const,
        created: new Date().toISOString(),
        target_topic: "billing",
        data: { word_count: 6000, section_count: 15 },
      };
      await appendReviewItems([item], config);
      // Try adding same type+target again with different id
      const item2 = { ...item, id: "rq-test-2" };
      const result = await appendReviewItems([item2], config);
      expect(result.added).toBe(0);

      const queue = await loadReviewQueue(config);
      expect(queue.items.length).toBe(1);
    });
  });

  it("dismissReviewItem updates status", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      await appendReviewItems([{
        id: "rq-test-1",
        type: "stale_topic" as const,
        status: "pending" as const,
        created: new Date().toISOString(),
        target_topic: "old-topic",
        data: { days_ignored: 45 },
      }], config);

      await dismissReviewItem("rq-test-1", config);
      const queue = await loadReviewQueue(config);
      expect(queue.items[0].status).toBe("dismissed");
    });
  });

  it("approveReviewItem updates status", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      await appendReviewItems([{
        id: "rq-test-1",
        type: "bloated_page" as const,
        status: "pending" as const,
        created: new Date().toISOString(),
        target_topic: "billing",
        data: { word_count: 6000, section_count: 15 },
      }], config);

      await approveReviewItem("rq-test-1", config);
      const queue = await loadReviewQueue(config);
      expect(queue.items[0].status).toBe("approved");
    });
  });
});
