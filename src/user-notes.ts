// src/user-notes.ts
// User note file I/O: create, read, update, delete, list.
// User notes are user-authored markdown files stored in ~/.memory-system/notes/.
// The system never modifies them — only the user can edit/delete.

import path from "node:path";
import fs from "node:fs/promises";
import { Config, UserNote } from "./types.js";
import { expandPath, ensureDir, atomicWrite, hashContent } from "./utils.js";
import { withLock } from "./lock.js";

// ============================================================================
// PARSING
// ============================================================================

export interface ParsedUserNote {
  frontmatter: UserNote;
  body: string;
  raw: string;
}

/** Parse a user note markdown file into frontmatter + body. */
export function parseUserNote(raw: string): ParsedUserNote {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error("User note missing YAML frontmatter");
  }

  const fmLines = fmMatch[1].split("\n");
  const fm: Record<string, any> = {};
  for (const line of fmLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: any = line.slice(colonIdx + 1).trim();

    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith("[")) {
      // Simple array parsing for topics
      try {
        value = JSON.parse(value);
      } catch {
        value = [];
      }
    }
    fm[key] = value;
  }

  return {
    frontmatter: {
      id: fm.id || "",
      title: fm.title || "",
      created: fm.created || "",
      topics: Array.isArray(fm.topics) ? fm.topics : [],
      ingest: fm.ingest === true,
      starred: fm.starred === true,
    },
    body: fmMatch[2],
    raw,
  };
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/** Serialize a user note to markdown with YAML frontmatter. */
export function serializeUserNote(frontmatter: UserNote, body: string): string {
  const topicsStr = JSON.stringify(frontmatter.topics);
  return `---
id: ${frontmatter.id}
title: "${frontmatter.title.replace(/"/g, '\\"')}"
created: ${frontmatter.created}
topics: ${topicsStr}
ingest: ${frontmatter.ingest}
starred: ${frontmatter.starred}
---
${body}`;
}

// ============================================================================
// FILE I/O
// ============================================================================

/** Resolve the file path for a user note. */
export function userNotePath(id: string, config: Config): string {
  return path.join(expandPath(config.notesDir), `${id}.md`);
}

/** Generate a unique note ID. */
function generateNoteId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `note-${timestamp}-${random}`;
}

/** Create a new user note. Returns the note ID. */
export async function createUserNote(
  title: string,
  body: string,
  config: Config,
  options?: { topics?: string[] }
): Promise<string> {
  const id = generateNoteId();
  const frontmatter: UserNote = {
    id,
    title,
    created: new Date().toISOString(),
    topics: options?.topics || [],
    ingest: false,
    starred: false,
  };

  const notePath = userNotePath(id, config);
  await ensureDir(path.dirname(notePath));
  const content = serializeUserNote(frontmatter, body);
  await withLock(notePath, async () => {
    await atomicWrite(notePath, content);
  });

  return id;
}

/** Load a user note from disk. Returns null if not found. */
export async function loadUserNote(
  id: string,
  config: Config
): Promise<ParsedUserNote | null> {
  const notePath = userNotePath(id, config);
  try {
    const raw = await fs.readFile(notePath, "utf-8");
    return parseUserNote(raw);
  } catch {
    return null;
  }
}

/** Save an existing user note to disk with locking. */
export async function saveUserNote(
  id: string,
  frontmatter: UserNote,
  body: string,
  config: Config
): Promise<void> {
  const notePath = userNotePath(id, config);
  await ensureDir(path.dirname(notePath));
  const content = serializeUserNote(frontmatter, body);
  await withLock(notePath, async () => {
    await atomicWrite(notePath, content);
  });
}

/** Delete a user note from disk. Returns true if deleted, false if not found. */
export async function deleteUserNote(
  id: string,
  config: Config
): Promise<boolean> {
  const notePath = userNotePath(id, config);
  try {
    await fs.unlink(notePath);
    return true;
  } catch {
    return false;
  }
}

/** List all user notes. Returns frontmatter only (no body), sorted by created desc. */
export async function listUserNotes(config: Config): Promise<UserNote[]> {
  const notesDir = expandPath(config.notesDir);
  try {
    const files = await fs.readdir(notesDir);
    const notes: UserNote[] = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = await fs.readFile(path.join(notesDir, file), "utf-8");
        const parsed = parseUserNote(raw);
        notes.push(parsed.frontmatter);
      } catch {
        // Skip unparseable files
      }
    }

    // Sort by created date descending
    notes.sort((a, b) => (b.created > a.created ? 1 : b.created < a.created ? -1 : 0));
    return notes;
  } catch {
    // Directory doesn't exist yet
    return [];
  }
}
