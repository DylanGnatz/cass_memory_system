import { describe, it, expect } from "bun:test";
import {
  evidenceCountGateFromNotes,
  validateKnowledgeDelta,
} from "../src/validate.js";
import type { Config, KnowledgeDelta, ConfidenceTier } from "../src/types.js";

// Minimal config for tests — validation enabled, but no search DB
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: "anthropic",
    model: "test",
    validationEnabled: true,
    searchDbPath: "/tmp/nonexistent-test-search.db",
    ...overrides,
  } as Config;
}

// --- evidenceCountGateFromNotes ---

describe("evidenceCountGateFromNotes", () => {
  it("returns uncertain confidence with no sessions", async () => {
    const result = await evidenceCountGateFromNotes(
      "webhook HMAC validation",
      new Map(),
      makeConfig()
    );
    expect(result.passed).toBe(true);
    expect(result.sessionCount).toBe(0);
    expect(result.suggestedConfidence).toBe("uncertain");
    expect(result.reason).toContain("No historical evidence");
  });

  it("returns uncertain for no meaningful keywords", async () => {
    const result = await evidenceCountGateFromNotes(
      "the",
      new Map(),
      makeConfig()
    );
    expect(result.passed).toBe(true);
    expect(result.suggestedConfidence).toBe("uncertain");
  });

  it("returns inferred when 1 session matches with no failure", async () => {
    const notes = new Map([
      ["session-1", "We implemented webhook HMAC validation for billing. It works correctly now."],
    ]);
    const result = await evidenceCountGateFromNotes(
      "webhook HMAC validation",
      notes,
      makeConfig()
    );
    expect(result.passed).toBe(true);
    expect(result.sessionCount).toBe(1);
    expect(result.suggestedConfidence).toBe("inferred");
  });

  it("returns verified when ≥3 sessions with ≥2 successes", async () => {
    const notes = new Map([
      ["session-1", "Webhook validation works correctly for billing service."],
      ["session-2", "We successfully deployed the webhook validation module."],
      ["session-3", "Webhook validation was resolved and working now."],
    ]);
    const result = await evidenceCountGateFromNotes(
      "webhook validation",
      notes,
      makeConfig()
    );
    expect(result.passed).toBe(true);
    expect(result.sessionCount).toBe(3);
    expect(result.suggestedConfidence).toBe("verified");
  });

  it("auto-rejects on strong failure signal (≥3 failures, 0 success)", async () => {
    const notes = new Map([
      ["session-1", "The webhook validation failed to compile with error: missing import."],
      ["session-2", "Webhook validation crashed on startup."],
      ["session-3", "Webhook validation still broken after retry."],
    ]);
    const result = await evidenceCountGateFromNotes(
      "webhook validation",
      notes,
      makeConfig()
    );
    expect(result.passed).toBe(false);
    expect(result.failureCount).toBe(3);
    expect(result.suggestedConfidence).toBe("uncertain");
    expect(result.reason).toContain("Auto-rejecting");
  });

  it("returns uncertain for equal success/failure counts", async () => {
    const notes = new Map([
      ["session-1", "Webhook validation works correctly for billing."],
      ["session-2", "Webhook validation failed to compile initially."],
    ]);
    const result = await evidenceCountGateFromNotes(
      "webhook validation",
      notes,
      makeConfig()
    );
    expect(result.passed).toBe(true);
    // Equal success/failure → uncertain (code requires successCount > failureCount for inferred)
    expect(result.suggestedConfidence).toBe("uncertain");
  });

  it("returns inferred for mixed signals when success outweighs failure", async () => {
    const notes = new Map([
      ["session-1", "Webhook validation works correctly for billing."],
      ["session-2", "Webhook validation failed to compile initially."],
      ["session-3", "We successfully deployed webhook validation."],
    ]);
    const result = await evidenceCountGateFromNotes(
      "webhook validation",
      notes,
      makeConfig()
    );
    expect(result.passed).toBe(true);
    expect(result.suggestedConfidence).toBe("inferred");
  });
});

// --- validateKnowledgeDelta ---

describe("validateKnowledgeDelta", () => {
  const config = makeConfig();

  it("passes through topic_suggestion without validation", async () => {
    const delta: KnowledgeDelta = {
      type: "topic_suggestion",
      slug: "new-topic",
      name: "New Topic",
      description: "A topic",
      suggested_from_session: "session-1",
    };
    const result = await validateKnowledgeDelta(delta, new Map(), config);
    expect(result.valid).toBe(true);
    expect(result.decisionLog[0].action).toBe("skipped");
  });

  it("passes through digest_update without validation", async () => {
    const delta: KnowledgeDelta = {
      type: "digest_update",
      date: "2026-03-23",
      content: "Built webhook handler.",
      sessions_covered: ["session-1"],
    };
    const result = await validateKnowledgeDelta(delta, new Map(), config);
    expect(result.valid).toBe(true);
  });

  it("skips validation when disabled", async () => {
    const delta: KnowledgeDelta = {
      type: "knowledge_page_append",
      topic_slug: "billing",
      section_id: "sec-1",
      section_title: "Webhook Config",
      content: "The billing service exposes webhooks at /api/v2/hooks/billing.",
      confidence: "inferred",
      source_session: "session-1",
      added_date: "2026-03-23",
      related_bullets: [],
    };
    const result = await validateKnowledgeDelta(
      delta, new Map(), makeConfig({ validationEnabled: false })
    );
    expect(result.valid).toBe(true);
    expect(result.confidence).toBe("inferred");
  });

  it("skips validation for short content", async () => {
    const delta: KnowledgeDelta = {
      type: "knowledge_page_append",
      topic_slug: "billing",
      section_id: "sec-1",
      section_title: "Short",
      content: "Too short.",
      confidence: "inferred",
      source_session: "session-1",
      added_date: "2026-03-23",
      related_bullets: [],
    };
    const result = await validateKnowledgeDelta(delta, new Map(), config);
    expect(result.valid).toBe(true);
    expect(result.confidence).toBe("inferred");
  });

  it("validates knowledge_page_append and upgrades confidence", async () => {
    const notes = new Map([
      ["session-1", "Successfully implemented webhook HMAC validation for billing. It works correctly."],
      ["session-2", "Webhook HMAC validation successfully deployed to staging."],
      ["session-3", "Webhook HMAC validation resolved and working now in production."],
    ]);
    const delta: KnowledgeDelta = {
      type: "knowledge_page_append",
      topic_slug: "billing",
      section_id: "sec-1",
      section_title: "HMAC Validation",
      content: "Webhook HMAC validation uses SHA-256 signatures for request integrity.",
      confidence: "inferred", // Should upgrade to verified with 3 sessions
      source_session: "session-1",
      added_date: "2026-03-23",
      related_bullets: [],
    };
    const result = await validateKnowledgeDelta(delta, notes, config);
    expect(result.valid).toBe(true);
    expect(result.confidence).toBe("verified");
  });

  it("never downgrades confidence", async () => {
    // Even with no evidence, verified stays verified
    const delta: KnowledgeDelta = {
      type: "knowledge_page_append",
      topic_slug: "billing",
      section_id: "sec-1",
      section_title: "HMAC Validation",
      content: "Webhook HMAC validation uses SHA-256 signatures for request integrity.",
      confidence: "verified",
      source_session: "session-1",
      added_date: "2026-03-23",
      related_bullets: [],
    };
    const result = await validateKnowledgeDelta(delta, new Map(), config);
    expect(result.valid).toBe(true);
    expect(result.confidence).toBe("verified");
  });

  it("rejects on strong failure evidence", async () => {
    const notes = new Map([
      ["session-1", "The webhook validation failed to compile with error: missing import."],
      ["session-2", "Webhook validation crashed on startup."],
      ["session-3", "Webhook validation still broken after retry."],
    ]);
    const delta: KnowledgeDelta = {
      type: "knowledge_page_append",
      topic_slug: "billing",
      section_id: "sec-1",
      section_title: "Webhook Validation",
      content: "Webhook validation is reliable and never fails in production.",
      confidence: "verified",
      source_session: "session-1",
      added_date: "2026-03-23",
      related_bullets: [],
    };
    const result = await validateKnowledgeDelta(delta, notes, config);
    expect(result.valid).toBe(false);
  });
});
