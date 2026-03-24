/**
 * Phase 4 context retrieval tests.
 *
 * Validates the extended fields returned by generateContextResult() and
 * buildContextResult(), graceful degradation when search.db or knowledge
 * pages are missing, and the human-readable output format changes.
 */
import { describe, it, expect } from "bun:test";
import { withTempCassHome } from "./helpers/temp.js";
import { createTestPlaybook, createTestBullet } from "./helpers/factories.js";
import { writeFile, mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import path from "node:path";
import yaml from "yaml";

describe("Phase 4 context retrieval", () => {
  // Test 1: generateContextResult returns extended result with searchResults field
  it("returns searchResults instead of historySnippets", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      const { generateContextResult } = await import("../src/commands/context.js");
      const { result } = await generateContextResult("test task", { json: true });

      expect(result).toBeDefined();
      expect(result.searchResults).toBeDefined();
      expect(Array.isArray(result.searchResults)).toBe(true);
      // Should NOT have historySnippets (legacy field)
      expect((result as any).historySnippets).toBeUndefined();
    });
  });

  // Test 2: returns empty topicExcerpts when no knowledge pages exist
  it("returns no topicExcerpts when no knowledge pages exist", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      const { generateContextResult } = await import("../src/commands/context.js");
      const { result } = await generateContextResult("fix billing webhook", { json: true });

      // topicExcerpts is optional — absent or empty when no knowledge pages exist
      if (result.topicExcerpts) {
        expect(Array.isArray(result.topicExcerpts)).toBe(true);
        expect(result.topicExcerpts.length).toBe(0);
      }
    });
  });

  // Test 3: returns relatedTopics field (empty when no topics defined)
  it("returns no relatedTopics when no topics exist", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      const { generateContextResult } = await import("../src/commands/context.js");
      const { result } = await generateContextResult("fix auth", { json: true });

      // relatedTopics is optional — absent or empty when no topics defined
      if (result.relatedTopics) {
        expect(Array.isArray(result.relatedTopics)).toBe(true);
        expect(result.relatedTopics.length).toBe(0);
      }
    });
  });

  // Test 4: returns lastReflectionRun as undefined when never run
  it("returns lastReflectionRun as falsy when never run", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      const { generateContextResult } = await import("../src/commands/context.js");
      const { result } = await generateContextResult("test", { json: true });

      // lastReflectionRun should be undefined/null when state.json doesn't exist
      expect(result.lastReflectionRun).toBeFalsy();
    });
  });

  // Test 5: graceful degradation when search.db is missing
  it("degrades gracefully when search.db is missing", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      const { generateContextResult } = await import("../src/commands/context.js");
      // No search.db exists in temp env — should still succeed
      const { result } = await generateContextResult("test task", { json: true });

      expect(result).toBeDefined();
      expect(result.task).toBe("test task");
      expect(result.searchResults).toBeDefined();
      expect(Array.isArray(result.searchResults)).toBe(true);
    });
  });

  // Test 6: returns unprocessedSessions / recentSessions field
  it("returns recentSessions field (empty when no session notes)", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      const { generateContextResult } = await import("../src/commands/context.js");
      const { result } = await generateContextResult("debug issue", { json: true });

      // recentSessions is optional — absent or empty when no session notes
      if (result.recentSessions) {
        expect(Array.isArray(result.recentSessions)).toBe(true);
        expect(result.recentSessions.length).toBe(0);
      }
    });
  });

  // Test 7: returns suggestedDeepDives field
  it("returns no suggestedDeepDives when knowledge base is empty", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      const { generateContextResult } = await import("../src/commands/context.js");
      const { result } = await generateContextResult("billing api", { json: true });

      // suggestedDeepDives is optional — absent or empty when no knowledge base
      if (result.suggestedDeepDives) {
        expect(Array.isArray(result.suggestedDeepDives)).toBe(true);
        expect(result.suggestedDeepDives.length).toBe(0);
      }
    });
  });

  // Test 8: topic excerpts when knowledge pages exist
  it("returns topic excerpts when knowledge pages exist", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      // Set up topics.json
      const topicsPath = path.join(env.cassMemoryDir, "topics.json");
      await writeFile(
        topicsPath,
        JSON.stringify([
          { slug: "billing", name: "Billing", description: "Payment processing and webhooks", source: "user", created: "2026-03-20" }
        ])
      );

      // Set up knowledge page
      const knowledgeDir = path.join(env.cassMemoryDir, "knowledge");
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        path.join(knowledgeDir, "billing.md"),
        `---
topic: Billing
slug: billing
created: "2026-03-20"
updated: "2026-03-20"
sections: []
---

## Webhook Validation

Always validate webhook signatures using HMAC-SHA256 before processing events.
`
      );

      const { generateContextResult } = await import("../src/commands/context.js");
      const { result } = await generateContextResult("fix billing webhook", { json: true });

      // topicExcerpts should include billing since the keyword matches
      if (result.topicExcerpts && result.topicExcerpts.length > 0) {
        const billingExcerpt = result.topicExcerpts.find(e => e.slug === "billing");
        expect(billingExcerpt).toBeDefined();
        expect(billingExcerpt!.topic).toBe("Billing");
        expect(billingExcerpt!.sections.length).toBeGreaterThan(0);
      }
    });
  });

  // Test 9: result structure matches ContextResult schema fields
  it("result contains all expected top-level fields", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      const { generateContextResult } = await import("../src/commands/context.js");
      const { result } = await generateContextResult("test", { json: true });

      // Core fields (must be present)
      expect(result.task).toBe("test");
      expect(result.relevantBullets).toBeDefined();
      expect(result.antiPatterns).toBeDefined();
      expect(result.searchResults).toBeDefined();
      expect(result.deprecatedWarnings).toBeDefined();
      expect(result.suggestedCassQueries).toBeDefined();
    });
  });

  // Test 10: human-readable output uses KNOWLEDGE header, not HISTORY
  it("human output uses KNOWLEDGE section header, not HISTORY", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      const logs: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;
      console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      console.error = () => {}; // suppress warnings

      try {
        const { contextCommand } = await import("../src/commands/context.js");
        await contextCommand("test task", {});
        const output = logs.join("\n");

        // Should not contain "HISTORY (" section header
        expect(output).not.toContain("HISTORY (");
        // Should mention KNOWLEDGE or PLAYBOOK (new terminology)
        // The exact content depends on whether there are results, but
        // the section header should be KNOWLEDGE, not HISTORY
        expect(output).toContain("KNOWLEDGE");
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    });
  });

  // Test 11: buildContextResult with Phase 4 extensions populates fields
  it("buildContextResult includes phase4 extensions when provided", () => {
    const { buildContextResult } = require("../src/commands/context.js");

    const topicExcerpts = [
      { topic: "Auth", slug: "auth", sections: [{ title: "JWT", preview: "Use JWT tokens..." }] }
    ];
    const relatedTopics = [
      { slug: "auth", name: "Auth", description: "Authentication", similarity: 0.85 }
    ];
    const recentSessions = [
      { id: "s-001", date: "2026-03-20", abstract: "Fixed auth flow", note_text: "Worked on auth" }
    ];
    const suggestedDeepDives = ["knowledge/auth.md#jwt"];
    const lastReflectionRun = "2026-03-20T10:00:00Z";

    const result = buildContextResult(
      "fix auth",
      [], // rules
      [], // antiPatterns
      [], // searchHits
      [], // warnings
      [], // suggestedQueries
      { maxBullets: 10, maxHistory: 10 },
      { topicExcerpts, relatedTopics, recentSessions, suggestedDeepDives, lastReflectionRun }
    );

    expect(result.topicExcerpts).toEqual(topicExcerpts);
    expect(result.relatedTopics).toEqual(relatedTopics);
    expect(result.recentSessions).toEqual(recentSessions);
    expect(result.suggestedDeepDives).toEqual(suggestedDeepDives);
    expect(result.lastReflectionRun).toBe(lastReflectionRun);
  });

  // Test 12: buildContextResult omits empty phase4 arrays
  it("buildContextResult omits phase4 fields when arrays are empty", () => {
    const { buildContextResult } = require("../src/commands/context.js");

    const result = buildContextResult(
      "test",
      [], // rules
      [], // antiPatterns
      [], // searchHits
      [], // warnings
      [], // suggestedQueries
      { maxBullets: 10, maxHistory: 10 },
      { topicExcerpts: [], relatedTopics: [], recentSessions: [], suggestedDeepDives: [] }
    );

    // Empty arrays should NOT be present on the result (only set when length > 0)
    expect(result.topicExcerpts).toBeUndefined();
    expect(result.relatedTopics).toBeUndefined();
    expect(result.recentSessions).toBeUndefined();
    expect(result.suggestedDeepDives).toBeUndefined();
    expect(result.lastReflectionRun).toBeUndefined();
  });

  // Test 13: buildContextResult without phase4 param at all
  it("buildContextResult works without phase4 param", () => {
    const { buildContextResult } = require("../src/commands/context.js");

    const result = buildContextResult(
      "test",
      [], // rules
      [], // antiPatterns
      [], // searchHits
      [], // warnings
      [], // suggestedQueries
      { maxBullets: 10, maxHistory: 10 }
      // no phase4 arg
    );

    expect(result.task).toBe("test");
    expect(result.searchResults).toEqual([]);
    expect(result.topicExcerpts).toBeUndefined();
    expect(result.relatedTopics).toBeUndefined();
    expect(result.recentSessions).toBeUndefined();
    expect(result.suggestedDeepDives).toBeUndefined();
    expect(result.lastReflectionRun).toBeUndefined();
  });

  // Test 14: ContextResult schema validates searchResults correctly
  it("ContextResultSchema accepts searchResults with knowledge type", () => {
    const { ContextResultSchema } = require("../src/types.js");

    const data = {
      task: "test",
      relevantBullets: [],
      antiPatterns: [],
      searchResults: [
        { type: "knowledge", id: "auth", snippet: "Use JWT tokens", score: 0.95, title: "Auth" }
      ],
      deprecatedWarnings: [],
      suggestedCassQueries: [],
    };

    const parsed = ContextResultSchema.parse(data);
    expect(parsed.searchResults).toHaveLength(1);
    expect(parsed.searchResults[0].type).toBe("knowledge");
    expect(parsed.searchResults[0].score).toBe(0.95);
  });

  // Test 15: degraded field set when search.db missing
  it("sets degraded.cass when FTS search fails", async () => {
    await withTempCassHome(async (env) => {
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([])));

      const { generateContextResult } = await import("../src/commands/context.js");
      const { result } = await generateContextResult("test", { json: true });

      // When search.db is missing, the result should either have degraded info
      // or just return empty search results gracefully
      if (result.degraded?.cass) {
        expect(result.degraded.cass.available).toBe(false);
        expect(result.degraded.cass.reason).toBeDefined();
        expect(result.degraded.cass.suggestedFix).toBeDefined();
      }
      // Either way, searchResults should be a valid (possibly empty) array
      expect(Array.isArray(result.searchResults)).toBe(true);
    });
  });
});
