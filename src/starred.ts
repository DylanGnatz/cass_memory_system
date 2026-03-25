// src/starred.ts
// Starred items index: star/unstar any content by path.
// Uses a separate index file (~/.memory-system/starred.json) rather than modifying
// file frontmatter, to avoid triggering user_edited semantics on system-generated files
// and to keep the starring concern decoupled from file formats.

import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { Config } from "./types.js";
import { expandPath, ensureDir, atomicWrite } from "./utils.js";
import { withLock } from "./lock.js";

// ============================================================================
// SCHEMA
// ============================================================================

export const StarredItemSchema = z.object({
  path: z.string(),
  section: z.string().optional(),
  starred_at: z.string(),
});
export type StarredItem = z.infer<typeof StarredItemSchema>;

const StarredFileSchema = z.object({
  items: z.array(StarredItemSchema).default([]),
});
type StarredFile = z.infer<typeof StarredFileSchema>;

// ============================================================================
// FILE I/O
// ============================================================================

/** Resolve starred.json file path. */
function starredPath(config: Config): string {
  const baseDir = path.dirname(expandPath(config.stateJsonPath));
  return path.join(baseDir, "starred.json");
}

/** Load starred items. Returns empty list if file doesn't exist. */
export async function loadStarred(config: Config): Promise<StarredItem[]> {
  const filePath = starredPath(config);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = StarredFileSchema.parse(JSON.parse(raw));
    return parsed.items;
  } catch {
    return [];
  }
}

/** Save starred items with locking + atomic write. */
async function saveStarred(items: StarredItem[], config: Config): Promise<void> {
  const filePath = starredPath(config);
  await ensureDir(path.dirname(filePath));
  const content = JSON.stringify({ items }, null, 2);
  await withLock(filePath, async () => {
    await atomicWrite(filePath, content);
  });
}

// ============================================================================
// OPERATIONS
// ============================================================================

/** Composite key for dedup. */
function starKey(itemPath: string, section?: string): string {
  return section ? `${itemPath}::${section}` : itemPath;
}

/** Star an item. Returns true if newly starred, false if already starred. */
export async function starItem(
  itemPath: string,
  config: Config,
  options?: { section?: string }
): Promise<boolean> {
  const items = await loadStarred(config);
  const key = starKey(itemPath, options?.section);
  const existing = items.find(i => starKey(i.path, i.section) === key);
  if (existing) return false;

  items.push({
    path: itemPath,
    section: options?.section,
    starred_at: new Date().toISOString(),
  });
  await saveStarred(items, config);
  return true;
}

/** Unstar an item. Returns true if removed, false if wasn't starred. */
export async function unstarItem(
  itemPath: string,
  config: Config,
  options?: { section?: string }
): Promise<boolean> {
  const items = await loadStarred(config);
  const key = starKey(itemPath, options?.section);
  const idx = items.findIndex(i => starKey(i.path, i.section) === key);
  if (idx === -1) return false;

  items.splice(idx, 1);
  await saveStarred(items, config);
  return true;
}

/** Check if an item is starred. */
export async function isStarred(
  itemPath: string,
  config: Config,
  options?: { section?: string }
): Promise<boolean> {
  const items = await loadStarred(config);
  const key = starKey(itemPath, options?.section);
  return items.some(i => starKey(i.path, i.section) === key);
}
