import { describe, it, expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { withTempCassHome } from "./helpers/temp.js";
import { createTestBullet, createTestPlaybook } from "./helpers/factories.js";
import { __test } from "../src/commands/serve.js";

const { routeRequest } = __test;

function callTool(name: string, args: any) {
  return routeRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

function parseToolResult(response: any): any {
  const content = response?.result?.content;
  if (!content || !content[0]?.text) return null;
  return JSON.parse(content[0].text);
}

// ============================================================================
// cm_search tool
// ============================================================================

describe("Phase 4 cm_search", () => {
  it("returns results structure with total", async () => {
    await withTempCassHome(async () => {
      const response = await callTool("cm_search", { query: "test" });
      const result = parseToolResult(response);
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(typeof result.total).toBe("number");
    });
  });

  it("searches playbook scope with substring match", async () => {
    await withTempCassHome(async (env) => {
      const bullet = createTestBullet({
        id: "b-webhook-001",
        content: "Always validate webhook signatures",
        category: "security",
        state: "active",
      });
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([bullet])));

      const response = await callTool("cm_search", {
        query: "webhook",
        scope: "playbook",
      });
      const result = parseToolResult(response);
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].type).toBe("playbook");
      expect(result.results[0].snippet).toContain("webhook");
    });
  });

  it("handles missing search.db gracefully", async () => {
    await withTempCassHome(async () => {
      const response = await callTool("cm_search", {
        query: "test",
        scope: "knowledge",
      });
      const result = parseToolResult(response);
      // Should return empty results, not error
      expect(result.results).toBeDefined();
      expect(result.total).toBe(0);
    });
  });

  it("validates required query parameter", async () => {
    await withTempCassHome(async () => {
      const response = await callTool("cm_search", {});
      expect(response.result?.isError).toBe(true);
    });
  });

  it("rejects empty query", async () => {
    await withTempCassHome(async () => {
      const response = await callTool("cm_search", { query: "   " });
      expect(response.result?.isError).toBe(true);
    });
  });

  it("respects limit parameter", async () => {
    await withTempCassHome(async () => {
      const response = await callTool("cm_search", {
        query: "test",
        limit: 5,
      });
      const result = parseToolResult(response);
      expect(result.results.length).toBeLessThanOrEqual(5);
    });
  });

  it("validates scope enum", async () => {
    await withTempCassHome(async () => {
      const response = await callTool("cm_search", {
        query: "test",
        scope: "invalid_scope",
      });
      expect(response.result?.isError).toBe(true);
      const result = parseToolResult(response);
      expect(result.error).toContain("scope");
    });
  });

  it("playbook results include id and score", async () => {
    await withTempCassHome(async (env) => {
      const bullet = createTestBullet({
        id: "b-search-id-001",
        content: "Use parameterized queries to prevent SQL injection",
        category: "security",
        state: "active",
      });
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([bullet])));

      const response = await callTool("cm_search", {
        query: "SQL injection",
        scope: "playbook",
      });
      const result = parseToolResult(response);
      expect(result.results.length).toBe(1);
      expect(result.results[0].id).toBe("b-search-id-001");
      expect(typeof result.results[0].score).toBe("number");
    });
  });

  it("playbook search matches on category field", async () => {
    await withTempCassHome(async (env) => {
      const bullet = createTestBullet({
        id: "b-cat-match-001",
        content: "Keep functions small and focused",
        category: "code-quality",
        state: "active",
      });
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([bullet])));

      const response = await callTool("cm_search", {
        query: "code-quality",
        scope: "playbook",
      });
      const result = parseToolResult(response);
      expect(result.results.length).toBe(1);
      expect(result.results[0].id).toBe("b-cat-match-001");
    });
  });

  it("returns empty results when no playbook bullets match", async () => {
    await withTempCassHome(async (env) => {
      const bullet = createTestBullet({
        id: "b-nomatch-001",
        content: "Use TypeScript strict mode",
        category: "tooling",
        state: "active",
      });
      writeFileSync(env.playbookPath, yaml.stringify(createTestPlaybook([bullet])));

      const response = await callTool("cm_search", {
        query: "kubernetes deployment",
        scope: "playbook",
      });
      const result = parseToolResult(response);
      expect(result.results.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  it("excludes deprecated bullets from playbook search", async () => {
    await withTempCassHome(async (env) => {
      const activeBullet = createTestBullet({
        id: "b-active-dep-test",
        content: "Active bullet about auth tokens",
        category: "security",
        state: "active",
      });
      const deprecatedBullet = createTestBullet({
        id: "b-deprecated-dep-test",
        content: "Deprecated bullet about auth tokens",
        category: "security",
        state: "retired",
        deprecated: true,
      });
      writeFileSync(
        env.playbookPath,
        yaml.stringify(createTestPlaybook([activeBullet, deprecatedBullet]))
      );

      const response = await callTool("cm_search", {
        query: "auth tokens",
        scope: "playbook",
      });
      const result = parseToolResult(response);
      // getActiveBullets filters out deprecated bullets
      const ids = result.results.map((r: any) => r.id);
      expect(ids).toContain("b-active-dep-test");
      expect(ids).not.toContain("b-deprecated-dep-test");
    });
  });
});

// ============================================================================
// cm_detail tool
// ============================================================================

describe("Phase 4 cm_detail", () => {
  it("reads a knowledge page", async () => {
    await withTempCassHome(async (env) => {
      const knowledgeDir = path.join(env.cassMemoryDir, "knowledge");
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        path.join(knowledgeDir, "billing.md"),
        `---
topic: Billing
description: Payment processing knowledge
source: system
created: 2026-03-20
last_updated: 2026-03-20
---

## Webhook Validation

Always validate webhook signatures using HMAC-SHA256.
`
      );

      const response = await callTool("cm_detail", {
        path: "knowledge/billing.md",
      });
      const result = parseToolResult(response);
      expect(result.content_type).toBe("knowledge_page");
      expect(result.content).toContain("Webhook Validation");
      expect(result.sections).toBeDefined();
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.sections[0].title).toBe("Webhook Validation");
    });
  });

  it("extracts a specific section from knowledge page", async () => {
    await withTempCassHome(async (env) => {
      const knowledgeDir = path.join(env.cassMemoryDir, "knowledge");
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        path.join(knowledgeDir, "auth.md"),
        `---
topic: Auth
description: Authentication knowledge
source: system
created: 2026-03-20
last_updated: 2026-03-20
---

## JWT Validation

Validate JWT tokens using RS256 algorithm.

## Session Management

Sessions expire after 24 hours.
`
      );

      const response = await callTool("cm_detail", {
        path: "knowledge/auth.md",
        section: "JWT Validation",
      });
      const result = parseToolResult(response);
      expect(result.content_type).toBe("knowledge_section");
      expect(result.section).toBe("JWT Validation");
      expect(result.path).toBe("knowledge/auth.md");
      expect(result.content).toContain("RS256");
    });
  });

  it("section extraction is case-insensitive", async () => {
    await withTempCassHome(async (env) => {
      const knowledgeDir = path.join(env.cassMemoryDir, "knowledge");
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        path.join(knowledgeDir, "ci.md"),
        `---
topic: CI
description: CI/CD knowledge
source: system
created: 2026-03-20
last_updated: 2026-03-20
---

## Build Pipeline

Use multi-stage Docker builds.
`
      );

      const response = await callTool("cm_detail", {
        path: "knowledge/ci.md",
        section: "build pipeline",
      });
      const result = parseToolResult(response);
      expect(result.content_type).toBe("knowledge_section");
      expect(result.section).toBe("Build Pipeline");
    });
  });

  it("returns error for non-existent section", async () => {
    await withTempCassHome(async (env) => {
      const knowledgeDir = path.join(env.cassMemoryDir, "knowledge");
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        path.join(knowledgeDir, "db.md"),
        `---
topic: Database
description: DB knowledge
source: system
created: 2026-03-20
last_updated: 2026-03-20
---

## Indexing

Use composite indexes for multi-column queries.
`
      );

      const response = await callTool("cm_detail", {
        path: "knowledge/db.md",
        section: "Nonexistent Section",
      });
      expect(response.result?.isError).toBe(true);
      const result = parseToolResult(response);
      expect(result.error).toContain("not found");
    });
  });

  it("rejects path traversal attempts", async () => {
    await withTempCassHome(async () => {
      const response = await callTool("cm_detail", {
        path: "../../etc/passwd",
      });
      expect(response.result?.isError).toBe(true);
      const result = parseToolResult(response);
      expect(result.error).toContain("Path traversal");
    });
  });

  it("returns error for non-existent files", async () => {
    await withTempCassHome(async () => {
      const response = await callTool("cm_detail", {
        path: "knowledge/nonexistent.md",
      });
      expect(response.result?.isError).toBe(true);
      const result = parseToolResult(response);
      expect(result.error).toContain("not found");
    });
  });

  it("identifies session notes by content type", async () => {
    await withTempCassHome(async (env) => {
      const notesDir = path.join(env.cassMemoryDir, "session-notes");
      await mkdir(notesDir, { recursive: true });
      await writeFile(
        path.join(notesDir, "test-session.md"),
        `---
id: test-session
abstract: Test session about auth
---

Session content here.
`
      );

      const response = await callTool("cm_detail", {
        path: "session-notes/test-session.md",
      });
      const result = parseToolResult(response);
      expect(result.content_type).toBe("session_note");
      expect(result.content).toContain("Session content here");
    });
  });

  it("identifies digests by content type", async () => {
    await withTempCassHome(async (env) => {
      const digestsDir = path.join(env.cassMemoryDir, "digests");
      await mkdir(digestsDir, { recursive: true });
      await writeFile(
        path.join(digestsDir, "2026-03-24.md"),
        `# Daily Digest — 2026-03-24

## Summary

Worked on authentication improvements.
`
      );

      const response = await callTool("cm_detail", {
        path: "digests/2026-03-24.md",
      });
      const result = parseToolResult(response);
      expect(result.content_type).toBe("digest");
      expect(result.content).toContain("authentication improvements");
    });
  });

  it("validates required path parameter", async () => {
    await withTempCassHome(async () => {
      const response = await callTool("cm_detail", {});
      expect(response.result?.isError).toBe(true);
    });
  });

  it("knowledge page without sections still returns sections array", async () => {
    await withTempCassHome(async (env) => {
      const knowledgeDir = path.join(env.cassMemoryDir, "knowledge");
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        path.join(knowledgeDir, "empty-topic.md"),
        `---
topic: Empty Topic
description: A topic with no sections
source: user
created: 2026-03-20
last_updated: 2026-03-20
---

Just some text with no H2 headings.
`
      );

      const response = await callTool("cm_detail", {
        path: "knowledge/empty-topic.md",
      });
      const result = parseToolResult(response);
      expect(result.content_type).toBe("knowledge_page");
      expect(Array.isArray(result.sections)).toBe(true);
    });
  });
});

// ============================================================================
// MCP resources (Phase 4 additions)
// ============================================================================

describe("Phase 4 MCP resources", () => {
  it("cm://topics returns topic list", async () => {
    await withTempCassHome(async (env) => {
      // topics.json must use the { topics: [...] } wrapper
      await writeFile(
        path.join(env.cassMemoryDir, "topics.json"),
        JSON.stringify({
          topics: [
            {
              slug: "billing",
              name: "Billing",
              description: "Payments",
              source: "user",
              created: "2026-03-20",
            },
          ],
        })
      );

      const response = await routeRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "cm://topics" },
      });

      expect("result" in response).toBe(true);
      if ("result" in response) {
        expect(response.result.data).toBeDefined();
        expect(response.result.data.length).toBe(1);
        expect(response.result.data[0].slug).toBe("billing");
      }
    });
  });

  it("cm://topics returns empty array when topics.json missing", async () => {
    await withTempCassHome(async () => {
      const response = await routeRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "cm://topics" },
      });

      expect("result" in response).toBe(true);
      if ("result" in response) {
        expect(response.result.data).toBeDefined();
        expect(response.result.data.length).toBe(0);
      }
    });
  });

  it("cm://status returns system status", async () => {
    await withTempCassHome(async () => {
      const response = await routeRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "cm://status" },
      });

      expect("result" in response).toBe(true);
      if ("result" in response) {
        expect(response.result.data).toBeDefined();
        expect(typeof response.result.data.topicCount).toBe("number");
        expect(typeof response.result.data.unprocessedSessionNotes).toBe(
          "number"
        );
      }
    });
  });

  it("cm://knowledge/{topic} returns knowledge page", async () => {
    await withTempCassHome(async (env) => {
      const knowledgeDir = path.join(env.cassMemoryDir, "knowledge");
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        path.join(knowledgeDir, "billing.md"),
        `---
topic: Billing
description: Payment processing
source: system
created: 2026-03-20
last_updated: 2026-03-20
---

## Section 1

Content here.
`
      );

      const response = await routeRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "cm://knowledge/billing" },
      });

      expect("result" in response).toBe(true);
      if ("result" in response) {
        expect(response.result.text).toBeDefined();
        expect(response.result.text).toContain("Section 1");
      }
    });
  });

  it("cm://knowledge/{topic} errors for missing topic", async () => {
    await withTempCassHome(async () => {
      const response = await routeRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "cm://knowledge/nonexistent" },
      });

      expect("error" in response).toBe(true);
      if ("error" in response) {
        expect(response.error.message).toContain("not found");
      }
    });
  });

  it("cm://today returns today's digest or not-found message", async () => {
    await withTempCassHome(async () => {
      const response = await routeRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "cm://today" },
      });

      // Should always succeed (returns "No digest found" text if file missing)
      expect("result" in response).toBe(true);
      if ("result" in response) {
        expect(response.result.text).toBeDefined();
      }
    });
  });

  it("cm://digest/{date} returns digest for specific date", async () => {
    await withTempCassHome(async (env) => {
      const digestsDir = path.join(env.cassMemoryDir, "digests");
      await mkdir(digestsDir, { recursive: true });
      await writeFile(
        path.join(digestsDir, "2026-03-20.md"),
        `# Daily Digest — 2026-03-20

## Key Insights

Discovered a better pattern for error handling.
`
      );

      const response = await routeRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "cm://digest/2026-03-20" },
      });

      expect("result" in response).toBe(true);
      if ("result" in response) {
        expect(response.result.text).toContain("error handling");
        expect(response.result.mimeType).toBe("text/markdown");
      }
    });
  });

  it("cm://digest/{date} errors for missing date", async () => {
    await withTempCassHome(async () => {
      const response = await routeRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "cm://digest/1999-01-01" },
      });

      expect("error" in response).toBe(true);
      if ("error" in response) {
        expect(response.error.message).toContain("not found");
      }
    });
  });
});
