/**
 * Parses ~/.claude/history.jsonl into a session-keyed prompt timeline.
 * Applies redaction and strips pastedContents before caching.
 */
import fs from 'fs';
import { redactText } from './redact';

export interface PromptEntry {
  display: string;
  timestamp: number;
}

interface RawHistoryEntry {
  display?: string;
  pastedContents?: Record<string, string>;
  timestamp?: number;
  project?: string;
  sessionId?: string;
}

/**
 * Parse history.jsonl content string into a Map keyed by sessionId.
 * pastedContents is stripped; display text is redacted.
 */
export function parseHistoryFile(
  content: string,
  extraPatterns?: string[],
): Map<string, PromptEntry[]> {
  const map = new Map<string, PromptEntry[]>();
  if (!content) return map;

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: RawHistoryEntry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }

    if (!entry.sessionId || !entry.display || entry.timestamp == null) {
      continue; // skip entries missing required fields
    }

    const prompt: PromptEntry = {
      display: redactText(entry.display, extraPatterns),
      timestamp: entry.timestamp,
    };

    const existing = map.get(entry.sessionId);
    if (existing) {
      existing.push(prompt);
    } else {
      map.set(entry.sessionId, [prompt]);
    }
  }

  // Sort each session's prompts by timestamp
  for (const [, prompts] of map) {
    prompts.sort((a, b) => a.timestamp - b.timestamp);
  }

  return map;
}

/**
 * Get prompts for a specific session from a pre-parsed map.
 */
export function getPromptsForSession(
  map: Map<string, PromptEntry[]>,
  sessionId: string,
): PromptEntry[] {
  return map.get(sessionId) ?? [];
}

/**
 * Lazy-loading cache for history.jsonl.
 * Checks file mtime on each access; reloads only when the file has changed.
 */
export class PromptTimelineCache {
  private cache: Map<string, PromptEntry[]> | null = null;
  private filePath: string;
  private lastMtime: number = 0;
  private extraPatterns?: string[];

  constructor(filePath: string, extraPatterns?: string[]) {
    this.filePath = filePath;
    this.extraPatterns = extraPatterns;
  }

  /** Get prompts for a session. Reloads cache if file changed. */
  getPrompts(sessionId: string): PromptEntry[] {
    this.ensureLoaded();
    return this.cache ? getPromptsForSession(this.cache, sessionId) : [];
  }

  /** Get the full session map. */
  getAllSessions(): Map<string, PromptEntry[]> {
    this.ensureLoaded();
    return this.cache ?? new Map();
  }

  /** Force cache invalidation (e.g. on config change). */
  invalidate(): void {
    this.cache = null;
    this.lastMtime = 0;
  }

  private ensureLoaded(): void {
    try {
      const stat = fs.statSync(this.filePath);
      const mtime = stat.mtimeMs;

      if (this.cache && mtime === this.lastMtime) return;

      const content = fs.readFileSync(this.filePath, 'utf-8');
      this.cache = parseHistoryFile(content, this.extraPatterns);
      this.lastMtime = mtime;
    } catch {
      // File doesn't exist or can't be read
      this.cache = new Map();
    }
  }
}
