import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { buildSharePath, parseAgent, parseShareQuestion, parseTone, terminalCommand } from "./agents.ts";

test("share paths hide the plaintext question and round-trip Unicode", () => {
  const question = "What is Claude? 🤔";
  const path = buildSharePath(question, "signature");
  const search = Object.fromEntries(new URL(path, "https://example.com").searchParams);

  assert.equal(path.includes("What"), false);
  assert.equal(path.includes("Claude"), false);
  assert.equal(parseShareQuestion(search), question);
  assert.equal(search.s, "signature");
});

test("legacy q links still work", () => {
  assert.equal(parseShareQuestion({ q: "  old question  " }), "old question");
});

test("malformed encoded questions do not leak into the page", () => {
  assert.equal(parseShareQuestion({ d: "%%%" }), "");
});

test("share links preserve both variants; links without a selection default to Claude", () => {
  for (const agent of ["codex", "claude"] as const) {
    const search = Object.fromEntries(new URL(buildSharePath("Explain × 🤔", "sig", agent), "https://example.com").searchParams);
    assert.equal(parseAgent(search.a), agent);
    assert.equal(parseShareQuestion(search), "Explain × 🤔");
  }
  assert.equal(parseAgent(undefined), "claude");
  assert.equal(parseAgent(null), "claude");
  assert.equal(new URL(buildSharePath("hello"), "https://example.com").searchParams.get("a"), "claude");
  assert.throws(() => parseAgent("other"), /Unknown agent/);
});

test("tones round-trip through share links; classic and unknown tones add nothing", () => {
  const tone = (path: string) => parseTone(new URL(path, "https://example.com").searchParams.get("t"));
  assert.equal(tone(buildSharePath("hi", "sig", "codex", "savage")), "savage");
  assert.equal(tone(buildSharePath("hi", "sig", "claude", "polite")), "polite");
  assert.equal(buildSharePath("hi", "sig", "claude", "classic"), buildSharePath("hi", "sig", "claude"));
  assert.equal(parseTone("rude"), "classic");
});

test("terminal commands pass the question to the shell verbatim", () => {
  const question = `it's "$HOME" \`whoami\` $(rm -rf /) !! \\ 'twice'\nline two`;
  for (const agent of ["codex", "claude"] as const) {
    const command = terminalCommand(agent, question);
    assert.ok(command.startsWith(`${agent} '`));
    // swap the agent for printf so the shell reports the argument it received
    const echoed = execFileSync("sh", ["-c", `printf %s ${command.slice(agent.length + 1)}`], { encoding: "utf8" });
    assert.equal(echoed, question);
  }
});
