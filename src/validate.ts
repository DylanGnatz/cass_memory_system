import {
  Config,
  PlaybookDelta,
  KnowledgeDelta,
  KnowledgePageAppendDelta,
  EvidenceGateResult,
  ValidationResult,
  ValidationEvidence,
  DecisionLogEntry,
  ConfidenceTier,
} from "./types.js";
import { runValidator, ValidatorResult } from "./llm.js";
import { safeCassSearch, type CassRunner } from "./cass.js";
import { extractKeywords, log, now, expandPath } from "./utils.js";
import { SearchIndex, openSearchIndex } from "./search.js";

// --- Verdict Normalization ---

/**
 * Normalize LLM validator result to our internal verdict types.
 * Maps REFINE to ACCEPT_WITH_CAUTION with reduced confidence.
 */
export function normalizeValidatorVerdict(result: ValidatorResult): ValidatorResult {
  if (result.verdict === "REFINE") {
    return {
      ...result,
      verdict: "ACCEPT_WITH_CAUTION",
      valid: true,
      confidence: result.confidence * 0.8 // Reduce confidence for refined rules
    };
  }
  return result;
}

// --- Pre-LLM Gate ---

// Word boundary patterns to avoid false positives like "fixed-width" or "error handling worked"
// These patterns match the words as standalone or at phrase boundaries
const SUCCESS_PATTERNS = [
  /\bfixed\s+(the|a|an|this|that|it)\b/i,        // "fixed the bug" but not "fixed-width"
  /\bsuccessfully\b/i,                            // "successfully deployed"
  /\bsuccess\b(?!ful)/i,                          // "success" but not "successful" (needs context)
  /\bsolved\s+(the|a|an|this|that|it)\b/i,       // "solved the issue"
  /\bworking\s+now\b/i,                           // "working now"
  /\bworks\s+(now|correctly|properly)\b/i,       // "works correctly"
  /\bresolved\b/i,                                // "resolved"
];

const FAILURE_PATTERNS = [
  /\bfailed\s+(to|with)\b/i,                      // "failed to compile" but not "failed CI" (could be action)
  /\berror:/i,                                    // "error:" prefix common in logs
  /\b(threw|throws)\s+.*error\b/i,               // "threw an error"
  /\bbroken\b/i,                                  // "broken"
  /\bcrash(ed|es|ing)?\b/i,                       // "crashed", "crashes"
  /\bbug\s+(in|found|caused)\b/i,                // "bug in", "bug found"
  /\bdoesn't\s+work\b/i,                          // "doesn't work"
];

function matchesPatterns(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

export async function evidenceCountGate(
  content: string,
  config: Config,
  runner?: CassRunner
): Promise<EvidenceGateResult> {
  const keywords = extractKeywords(content);
  if (keywords.length === 0) {
    return {
      passed: true,
      reason: "No meaningful keywords found for evidence search. Proposing as draft.",
      suggestedState: "draft",
      sessionCount: 0,
      successCount: 0,
      failureCount: 0
    };
  }

  const hits = runner
    ? await safeCassSearch(
        keywords.join(" "),
        {
          limit: 20,
          days: config.validationLookbackDays,
        },
        config.cassPath,
        config,
        runner
      )
    : await safeCassSearch(
        keywords.join(" "),
        {
          limit: 20,
          days: config.validationLookbackDays,
        },
        config.cassPath,
        config
      );

  const sessions = new Set<string>();
  const successSessions = new Set<string>();
  const failureSessions = new Set<string>();

  for (const hit of hits) {
    if (!hit.source_path) continue;
    const sessionPath = hit.source_path;
    sessions.add(sessionPath);

    const snippet = hit.snippet;
    // Use word-boundary aware patterns to reduce false positives
    if (matchesPatterns(snippet, SUCCESS_PATTERNS)) successSessions.add(sessionPath);
    if (matchesPatterns(snippet, FAILURE_PATTERNS)) failureSessions.add(sessionPath);
  }

  const sessionCount = sessions.size;
  // Count sessions (not individual hits) to avoid overweighting a single session with many matches.
  const successCount = successSessions.size;
  const failureCount = failureSessions.size;

  if (sessionCount === 0) {
    return {
      passed: true,
      reason: "No historical evidence found. Proposing as draft.",
      suggestedState: "draft",
      sessionCount, successCount, failureCount
    };
  }

  if (successCount >= 5 && failureCount === 0) {
    return {
      passed: true,
      reason: `Strong success signal (${successCount} sessions). Auto-accepting.`, 
      suggestedState: "active",
      sessionCount, successCount, failureCount
    };
  }

  if (failureCount >= 3 && successCount === 0) {
    return {
      passed: false,
      reason: `Strong failure signal (${failureCount} sessions). Auto-rejecting.`, 
      suggestedState: "draft",
      sessionCount, successCount, failureCount
    };
  }

  return {
    passed: true,
    reason: "Evidence found but ambiguous. Proceeding to LLM validation.",
    suggestedState: "draft",
    sessionCount, successCount, failureCount
  };
}

// --- Format Evidence for LLM ---

function formatEvidence(hits: any[]): string {
  return hits.map((h: any) => `
Session: ${h.source_path}
Snippet: "${h.snippet}"
Relevance: ${h.score}
`).join("\n---\n");
}

// --- Main Validator ---

export async function validateDelta(
  delta: PlaybookDelta,
  config: Config
): Promise<{ valid: boolean; result?: ValidationResult; gate?: EvidenceGateResult; decisionLog?: DecisionLogEntry[] }> {
  const decisionLog: DecisionLogEntry[] = [];

  if (delta.type !== "add") {
    decisionLog.push({
      timestamp: now(),
      phase: "add",
      action: "skipped",
      reason: `Non-add delta type: ${delta.type}`,
      content: undefined
    });
    return { valid: true, decisionLog };
  }

  if (!config.validationEnabled) {
    decisionLog.push({
      timestamp: now(),
      phase: "add",
      action: "skipped",
      reason: "Validation disabled in config",
      content: delta.bullet.content?.slice(0, 100)
    });
    return { valid: true, decisionLog };
  }

  const content = delta.bullet.content || "";
  if (content.length < 15) {
    decisionLog.push({
      timestamp: now(),
      phase: "add",
      action: "skipped",
      reason: `Content too short (${content.length} chars < 15)`,
      content: content.slice(0, 100)
    });
    return { valid: true, decisionLog };
  }

  // 1. Run Gate
  const gate = await evidenceCountGate(content, config);

  if (!gate.passed) {
    log(`Rule rejected by evidence gate: ${gate.reason}`);
    decisionLog.push({
      timestamp: now(),
      phase: "add",
      action: "rejected",
      reason: gate.reason,
      content: content.slice(0, 100),
      details: { sessionCount: gate.sessionCount, successCount: gate.successCount, failureCount: gate.failureCount }
    });
    return { valid: false, gate, decisionLog };
  }

  if (gate.suggestedState === "active") {
    decisionLog.push({
      timestamp: now(),
      phase: "add",
      action: "accepted",
      reason: `Auto-accepted by evidence gate: ${gate.reason}`,
      content: content.slice(0, 100),
      details: { sessionCount: gate.sessionCount, successCount: gate.successCount, failureCount: gate.failureCount }
    });
    return {
      valid: true,
      gate,
      result: {
        valid: true,
        verdict: "ACCEPT",
        confidence: 1.0,
        reason: gate.reason,
        evidence: [],
        approved: true,
        supportingEvidence: [],
        contradictingEvidence: []
      },
      decisionLog
    };
  }

  // Optimize: If gate suggests "draft" due to lack of evidence (0 sessions),
  // skip LLM validation (which would likely reject due to lack of evidence)
  // and accept as draft immediately.
  if (gate.suggestedState === "draft" && gate.sessionCount === 0) {
    decisionLog.push({
      timestamp: now(),
      phase: "add",
      action: "accepted",
      reason: `Accepted as draft (new pattern/no history): ${gate.reason}`,
      content: content.slice(0, 100)
    });
    return {
        valid: true,
        gate,
        decisionLog
    };
  }

  // 2. Run LLM
  const keywords = extractKeywords(content);
  const evidenceHits = await safeCassSearch(keywords.join(" "), { limit: 10 }, config.cassPath, config);
  const formattedEvidence = formatEvidence(evidenceHits);

  const rawResult = await runValidator(content, formattedEvidence, config);
  const result = normalizeValidatorVerdict(rawResult);

  let finalVerdict = result.verdict as "ACCEPT" | "REJECT" | "ACCEPT_WITH_CAUTION" | "REFINE";

  // Map object array to string array for 'evidence' field (legacy/schema compatibility)
  const evidenceStrings = result.evidence.map(e => e.snippet);

  // Map object array to ValidationEvidence[] for supporting/contradicting
  const supporting = result.evidence.filter(e => e.supports).map(e => ({
    sessionPath: e.sessionPath,
    snippet: e.snippet,
    supports: true,
    confidence: 1.0 // Default confidence
  }));

  const contradicting = result.evidence.filter(e => !e.supports).map(e => ({
    sessionPath: e.sessionPath,
    snippet: e.snippet,
    supports: false,
    confidence: 1.0
  }));

  // Log LLM validation decision
  decisionLog.push({
    timestamp: now(),
    phase: "add",
    action: result.valid ? "accepted" : "rejected",
    reason: `LLM validation: ${finalVerdict} - ${result.reason}`,
    content: content.slice(0, 100),
    details: {
      verdict: finalVerdict,
      confidence: result.confidence,
      supportingCount: supporting.length,
      contradictingCount: contradicting.length
    }
  });

  return {
    valid: result.valid,
    result: {
      ...result, // Spread raw props
      verdict: finalVerdict, // Override verdict if normalized
      evidence: evidenceStrings, // Override evidence with string[]
      refinedRule: result.suggestedRefinement, // Map suggestedRefinement -> refinedRule
      approved: result.valid,
      supportingEvidence: supporting,
      contradictingEvidence: contradicting
    },
    gate,
    decisionLog
  };
}

// ============================================================================
// PHASE 3: THREE-SOURCE EVIDENCE MODEL
// ============================================================================

/**
 * Three-source evidence gate for knowledge deltas (Phase 3).
 * Replaces cass binary search with:
 *   Source 1: Full session note text (SUCCESS/FAILURE patterns)
 *   Source 2: Knowledge page semantic search (contradictions/corroboration)
 *   Source 3: SQLite fts_transcripts (primary-source evidence)
 *
 * Source count heuristic: N≥3 independent sessions → higher base confidence.
 */
export async function evidenceCountGateFromNotes(
  content: string,
  sessionNoteBodies: Map<string, string>,
  config: Config,
): Promise<EvidenceGateResult & { suggestedConfidence: ConfidenceTier; sourceCount: number }> {
  const keywords = extractKeywords(content);
  if (keywords.length === 0) {
    return {
      passed: true,
      reason: "No meaningful keywords for evidence search. Accepting as draft.",
      suggestedState: "draft",
      sessionCount: 0,
      successCount: 0,
      failureCount: 0,
      suggestedConfidence: "uncertain",
      sourceCount: 0,
    };
  }

  const sessions = new Set<string>();
  const successSessions = new Set<string>();
  const failureSessions = new Set<string>();

  // Source 1: Search session note bodies for SUCCESS/FAILURE patterns
  for (const [sessionId, noteBody] of sessionNoteBodies) {
    const lowerBody = noteBody.toLowerCase();
    const queryTerms = keywords.map(k => k.toLowerCase());
    const hasRelevance = queryTerms.some(term => lowerBody.includes(term));
    if (!hasRelevance) continue;

    sessions.add(sessionId);
    if (matchesPatterns(noteBody, SUCCESS_PATTERNS)) successSessions.add(sessionId);
    if (matchesPatterns(noteBody, FAILURE_PATTERNS)) failureSessions.add(sessionId);
  }

  // Source 3: SQLite fts_transcripts (when available)
  try {
    const dbPath = expandPath(config.searchDbPath);
    const searchIndex = openSearchIndex(dbPath);
    try {
      const query = keywords.slice(0, 5).join(" ");
      const hits = searchIndex.search(query, { tables: ["transcripts"], limit: 20 });
      for (const hit of hits) {
        if (!hit.id) continue;
        const sessionId = hit.id;
        sessions.add(sessionId);
        if (matchesPatterns(hit.snippet || "", SUCCESS_PATTERNS)) successSessions.add(sessionId);
        if (matchesPatterns(hit.snippet || "", FAILURE_PATTERNS)) failureSessions.add(sessionId);
      }
    } finally {
      searchIndex.close();
    }
  } catch {
    // search.db may not exist yet — that's fine, skip source 3
  }

  const sessionCount = sessions.size;
  const successCount = successSessions.size;
  const failureCount = failureSessions.size;

  // Source count heuristic: N≥3 independent sessions → higher base confidence
  let suggestedConfidence: ConfidenceTier = "uncertain";
  if (sessionCount >= 3 && successCount >= 2 && failureCount === 0) {
    suggestedConfidence = "verified";
  } else if (sessionCount >= 1 && failureCount === 0) {
    suggestedConfidence = "inferred";
  } else if (failureCount > 0 && successCount > failureCount) {
    suggestedConfidence = "inferred"; // Mixed but mostly positive
  }

  // Auto-reject on strong failure signal
  if (failureCount >= 3 && successCount === 0) {
    return {
      passed: false,
      reason: `Strong failure signal (${failureCount} sessions). Auto-rejecting.`,
      suggestedState: "draft",
      sessionCount, successCount, failureCount,
      suggestedConfidence: "uncertain",
      sourceCount: sessionCount,
    };
  }

  // Auto-accept on strong success signal
  if (successCount >= 5 && failureCount === 0) {
    return {
      passed: true,
      reason: `Strong success signal (${successCount} sessions). Auto-accepting.`,
      suggestedState: "active",
      sessionCount, successCount, failureCount,
      suggestedConfidence: "verified",
      sourceCount: sessionCount,
    };
  }

  return {
    passed: true,
    reason: sessionCount === 0
      ? "No historical evidence found. Accepting as new knowledge."
      : `Found evidence in ${sessionCount} sessions (${successCount} success, ${failureCount} failure).`,
    suggestedState: "draft",
    sessionCount, successCount, failureCount,
    suggestedConfidence,
    sourceCount: sessionCount,
  };
}

/**
 * Validate a knowledge delta using the three-source evidence model.
 * Only validates knowledge_page_append deltas. Topic suggestions and
 * digest updates pass through without validation.
 */
export async function validateKnowledgeDelta(
  delta: KnowledgeDelta,
  sessionNoteBodies: Map<string, string>,
  config: Config
): Promise<{ valid: boolean; confidence?: ConfidenceTier; decisionLog: DecisionLogEntry[] }> {
  const decisionLog: DecisionLogEntry[] = [];

  // Only validate knowledge_page_append — topic suggestions and digest updates pass through
  if (delta.type !== "knowledge_page_append") {
    decisionLog.push({
      timestamp: now(),
      phase: "add",
      action: "skipped",
      reason: `Non-knowledge-append delta type: ${delta.type}`,
    });
    return { valid: true, decisionLog };
  }

  if (!config.validationEnabled) {
    decisionLog.push({
      timestamp: now(),
      phase: "add",
      action: "skipped",
      reason: "Validation disabled in config",
    });
    return { valid: true, confidence: delta.confidence, decisionLog };
  }

  const content = delta.content;
  if (content.length < 15) {
    decisionLog.push({
      timestamp: now(),
      phase: "add",
      action: "skipped",
      reason: `Content too short (${content.length} chars < 15)`,
    });
    return { valid: true, confidence: delta.confidence, decisionLog };
  }

  const gate = await evidenceCountGateFromNotes(content, sessionNoteBodies, config);

  if (!gate.passed) {
    decisionLog.push({
      timestamp: now(),
      phase: "add",
      action: "rejected",
      reason: gate.reason,
      content: content.slice(0, 100),
      details: { sessionCount: gate.sessionCount, successCount: gate.successCount, failureCount: gate.failureCount },
    });
    return { valid: false, decisionLog };
  }

  // Upgrade confidence if evidence supports it
  const finalConfidence = upgradeConfidence(delta.confidence, gate.suggestedConfidence);

  decisionLog.push({
    timestamp: now(),
    phase: "add",
    action: "accepted",
    reason: `${gate.reason} Confidence: ${delta.confidence} → ${finalConfidence}`,
    content: content.slice(0, 100),
    details: {
      sourceCount: gate.sourceCount,
      originalConfidence: delta.confidence,
      finalConfidence,
    },
  });

  return { valid: true, confidence: finalConfidence, decisionLog };
}

/**
 * Upgrade confidence tier based on evidence.
 * Only upgrades, never downgrades — the Reflector's initial assessment is the floor.
 */
function upgradeConfidence(original: ConfidenceTier, suggested: ConfidenceTier): ConfidenceTier {
  const rank: Record<ConfidenceTier, number> = { uncertain: 0, inferred: 1, verified: 2 };
  return rank[suggested] > rank[original] ? suggested : original;
}

/**
 * Check if a new knowledge section contradicts existing sections on the same topic.
 * Uses keyword overlap + semantic comparison to detect conflicting claims.
 * Returns contradiction info if found, null otherwise.
 */
export async function detectContradiction(
  delta: KnowledgePageAppendDelta,
  existingSections: Array<{ id: string; title: string; content: string; confidence: string; source: string; added: string }>,
): Promise<{
  contradicts: boolean;
  description: string;
  existingClaim: { claim: string; source: string; date: string; confidence: string; section_id: string };
  newClaim: { claim: string; source: string; date: string; confidence: string };
} | null> {
  if (existingSections.length === 0) return null;

  const newContent = delta.content.toLowerCase();
  const newKeywords = new Set(newContent.split(/\s+/).filter(w => w.length > 4));

  for (const existing of existingSections) {
    const existingContent = existing.content.toLowerCase();
    const existingKeywords = new Set(existingContent.split(/\s+/).filter(w => w.length > 4));

    // Check keyword overlap — high overlap suggests same topic area
    let overlap = 0;
    for (const kw of newKeywords) {
      if (existingKeywords.has(kw)) overlap++;
    }
    const overlapRatio = newKeywords.size > 0 ? overlap / newKeywords.size : 0;

    if (overlapRatio < 0.2) continue; // Not enough keyword overlap to be about the same thing

    // Check for contradiction signals: negation words near shared keywords,
    // different values for the same config/path, "actually", "not", "incorrect", "wrong"
    const contradictionSignals = [
      "actually", "not", "incorrect", "wrong", "instead", "rather than",
      "was incorrect", "doesn't", "does not", "shouldn't", "changed from",
      "no longer", "deprecated", "replaced by", "moved to", "renamed"
    ];

    const newHasSignal = contradictionSignals.some(s => newContent.includes(s));
    const titleOverlap = existing.title.toLowerCase().split(/\s+/).some(w =>
      w.length > 3 && delta.section_title.toLowerCase().includes(w)
    );

    // High overlap + contradiction signal + related title = likely contradiction
    if (overlapRatio > 0.3 && (newHasSignal || titleOverlap)) {
      return {
        contradicts: true,
        description: `New content for "${delta.section_title}" may contradict existing section "${existing.title}"`,
        existingClaim: {
          claim: existing.content.slice(0, 300),
          source: existing.source,
          date: existing.added,
          confidence: existing.confidence,
          section_id: existing.id,
        },
        newClaim: {
          claim: delta.content.slice(0, 300),
          source: delta.source_session,
          date: delta.added_date,
          confidence: delta.confidence,
        },
      };
    }
  }

  return null;
}
