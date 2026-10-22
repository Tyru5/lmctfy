import assert from "node:assert/strict";
import test from "node:test";
import { getCached, setCached } from "./store.ts";

test("the same question has independent Claude and Codex answers", async (t) => {
  for (const name of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
    const previous = process.env[name];
    delete process.env[name];
    t.after(() => {
      if (previous !== undefined) process.env[name] = previous;
    });
  }
  await setCached("Explain 42", [{ type: "text", text: "Codex answer" }], "codex");
  assert.equal(await getCached("Explain 42", "claude"), null);
  await setCached("Explain 42", [{ type: "text", text: "Claude answer" }], "claude");
  assert.deepEqual(await getCached("Explain 42", "codex"), [{ type: "text", text: "Codex answer" }]);
  assert.deepEqual(await getCached("Explain 42", "claude"), [{ type: "text", text: "Claude answer" }]);
});
