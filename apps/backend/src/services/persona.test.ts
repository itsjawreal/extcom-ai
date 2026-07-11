import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { extractVoiceSection, getPersonaVoice, personaInternals } from "./persona.js";

test("extractVoiceSection returns undefined when the Voice section is empty", () => {
  const content = "# Persona\n\nSome instructions.\n\n## Voice\n";
  assert.equal(extractVoiceSection(content), undefined);
});

test("extractVoiceSection returns undefined when the heading is missing entirely", () => {
  assert.equal(extractVoiceSection("# Persona\n\nno heading here\n"), undefined);
});

test("extractVoiceSection returns the trimmed content after the heading", () => {
  const content = "# Persona\n\nInstructions above.\n\n## Voice\n\nA blunt crypto trader, skeptical of hype.\n";
  assert.equal(extractVoiceSection(content), "A blunt crypto trader, skeptical of hype.");
});

test("extractVoiceSection ignores content before the heading", () => {
  const content = "Example: don't write this part\n\n## Voice\nReal persona text.";
  assert.equal(extractVoiceSection(content), "Real persona text.");
});

test("extractVoiceSection is not fooled by the heading being mentioned inline in prose", () => {
  // Regression: an earlier version used a naive indexOf("## Voice"), which
  // matched instructional prose quoting the heading by name (e.g. write
  // something under "## Voice") before reaching the real heading line —
  // silently truncating the persona to the boilerplate instructions
  // instead of the actual voice text below it.
  const content = [
    "Leave the Voice section empty to disable this.",
    'Write something under "## Voice": a short description.',
    "",
    "## Voice",
    "",
    "The real persona text.",
  ].join("\n");
  assert.equal(extractVoiceSection(content), "The real persona text.");
});

test("getPersonaVoice returns undefined when the file doesn't exist", async () => {
  const result = await getPersonaVoice("/definitely/not/a/real/path/PERSONA.md");
  assert.equal(result, undefined);
});

test("getPersonaVoice reads and parses a real file end-to-end", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "persona-test-"));
  const filePath = path.join(dir, "PERSONA.md");
  try {
    await writeFile(filePath, "# Persona\n\n## Voice\n\nSpeaks like a pirate.\n", "utf8");
    assert.equal(await getPersonaVoice(filePath), "Speaks like a pirate.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the shipped default PERSONA.md ships with an empty Voice section (inert by default)", async () => {
  // Regression guard: this file's default content should never accidentally
  // ship with something under "## Voice" that would change every reply's
  // behavior out of the box.
  assert.equal(await getPersonaVoice(personaInternals.DEFAULT_PERSONA_FILE_PATH), undefined);
});
