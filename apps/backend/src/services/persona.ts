import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolves to the backend package root regardless of whether this runs as
// compiled dist/services/persona.js (Docker/production) or as
// src/services/persona.ts via tsx (local dev) — both sit two directories
// below the package root PERSONA.md ships from.
const DEFAULT_PERSONA_FILE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "PERSONA.md",
);

// Anchored to a line start (not a bare indexOf) — the shipped file's own
// instructional prose mentions the heading by name in quotes ("the Voice
// section"), and a naive substring search matches that mention instead of
// the real heading line, silently truncating the persona to the boilerplate
// text above it. Requiring a preceding newline/string-start rules that out.
const VOICE_HEADING_PATTERN = /(?:^|\n)## Voice[ \t]*\r?\n?/;

// Only the content after the "## Voice" heading counts — everything above
// it in the shipped file is instructions for the human editing it, not
// meant to reach the AI.
export function extractVoiceSection(content: string): string | undefined {
  const match = VOICE_HEADING_PATTERN.exec(content);
  if (!match) return undefined;
  const section = content.slice(match.index + match[0].length).trim();
  return section || undefined;
}

// Re-read fresh on every call, deliberately not cached like the model
// catalog is — this isn't a session/memory, so there's nothing to
// invalidate; editing the file should take effect on the very next
// generation. Reading one small local file per request is cheap enough
// that caching would only add complexity, not meaningfully save time.
export async function getPersonaVoice(filePath: string = DEFAULT_PERSONA_FILE_PATH): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, "utf8");
    return extractVoiceSection(content);
  } catch {
    // Missing file (a deploy that forgot to copy it, a fresh checkout, a
    // typo'd override path) just means "no persona configured" — this is
    // an optional customization, never a hard requirement for generation.
    return undefined;
  }
}

export const personaInternals = { DEFAULT_PERSONA_FILE_PATH };
