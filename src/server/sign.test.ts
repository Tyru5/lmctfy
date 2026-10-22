import assert from "node:assert/strict";
import test from "node:test";
import { sign, verify } from "./sign.ts";

test("signatures authorize only the original question and variant", (t) => {
  const previous = process.env.LINK_SECRET;
  process.env.LINK_SECRET = "test-only-signing-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.LINK_SECRET;
    else process.env.LINK_SECRET = previous;
  });
  for (const agent of ["codex", "claude"] as const) {
    const signature = sign("Explain 42", agent);
    assert.equal(verify("Explain 42", signature, agent), true);
    assert.equal(verify("Explain 43", signature, agent), false);
    assert.equal(verify("Explain 42", signature, agent === "codex" ? "claude" : "codex"), false);
  }
  assert.equal(verify(JSON.stringify(["claude", "Explain 42"]), sign("Explain 42", "claude"), "codex"), false);
  assert.equal(verify("Explain 42", undefined), false);
});
