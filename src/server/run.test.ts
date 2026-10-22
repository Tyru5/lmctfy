import assert from "node:assert/strict";
import test from "node:test";
import { Sandbox } from "@vercel/sandbox";
import { runAgent, type RunEvent } from "./run.ts";

test("Codex JSONL becomes a transcript across chunk boundaries without duplicate messages", async (t) => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });
  let stopped = false;
  t.mock.method(Sandbox, "create", async () => ({
    runCommand: async ({ stdout }: { stdout: NodeJS.WritableStream }) => {
      const jsonl = [
        "not JSON",
        JSON.stringify({ type: "thread.started", thread_id: "test" }),
        JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "printf 42" } }),
        JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "printf 42", aggregated_output: "42" } }),
        JSON.stringify({ type: "item.updated", item: { type: "agent_message", text: "partial" } }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Answer: 42 🤖" } }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "**Done.**" } }),
      ].join("\n");
      // Split within a UTF-8 character; the final record has no newline.
      const bytes = Buffer.from(jsonl);
      const split = bytes.indexOf(Buffer.from("🤖")) + 2;
      stdout.write(bytes.subarray(0, split));
      stdout.write(bytes.subarray(split));
      return { exitCode: 0 };
    },
    stop: async () => { stopped = true; },
  }));
  const events: RunEvent[] = [];
  await runAgent("What is 6 × 7?", (event) => events.push(event), new AbortController().signal, "codex");
  assert.deepEqual(events.filter((event) => event.type !== "status"), [
    { type: "tool", text: "$ printf 42" },
    { type: "text", text: "Answer: 42 🤖\n" },
    { type: "text", text: "**Done.**\n" },
    { type: "done", exitCode: 0 },
  ]);
  assert.equal(stopped, true);
});

test("Claude streams its own transcript through direct and Gateway credentials", async (t) => {
  for (const gateway of [false, true]) {
    await t.test(gateway ? "Gateway" : "Anthropic", async (t) => {
      for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY"]) {
        const previous = process.env[name];
        delete process.env[name];
        t.after(() => {
          if (previous === undefined) delete process.env[name];
          else process.env[name] = previous;
        });
      }
      process.env.OPENAI_API_KEY = "test-codex-key-must-not-be-used";
      process.env[gateway ? "AI_GATEWAY_API_KEY" : "ANTHROPIC_API_KEY"] = "test-claude-credential";
      let stopped = false;
      t.mock.method(Sandbox, "create", async (options: NonNullable<Parameters<typeof Sandbox.create>[0]>) => {
        assert.ok(options.env);
        assert.ok(options.networkPolicy && typeof options.networkPolicy === "object" && options.networkPolicy.allow);
        assert.equal(JSON.stringify(options.env).includes("test-claude-credential"), false);
        const domain = gateway ? "ai-gateway.vercel.sh" : "api.anthropic.com";
        assert.deepEqual(Object.keys(options.networkPolicy.allow), [domain]);
        assert.equal(options.env.ANTHROPIC_BASE_URL, gateway ? "https://ai-gateway.vercel.sh/claude-code" : "https://api.anthropic.com");
        return {
          runCommand: async ({ cmd, args, stdout }: { cmd: string; args: string[]; stdout: NodeJS.WritableStream }) => {
            assert.equal(cmd, "claude");
            assert.equal(args[args.indexOf("-p") + 1], "Explain 42");
            stdout.write(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Answer: 42" } } }) + "\n");
            stdout.write(JSON.stringify({ type: "assistant", message: { content: [
              { type: "text", text: "Answer: 42" },
              { type: "tool_use", name: "Bash", input: { command: "printf 42" } },
            ] } }) + "\n");
            stdout.write(JSON.stringify({ type: "result", is_error: true, result: "Budget exceeded" }));
            return { exitCode: 1 };
          },
          stop: async () => { stopped = true; },
        };
      });
      const events: RunEvent[] = [];
      await runAgent("Explain 42", (e) => events.push(e), new AbortController().signal, "claude");
      assert.deepEqual(events.filter((e) => e.type !== "status"), [
        { type: "text", text: "Answer: 42" },
        { type: "tool", text: "Bash(printf 42)" },
        { type: "error", message: "Budget exceeded" },
        { type: "done", exitCode: 1 },
      ]);
      assert.equal(stopped, true);
    });
  }
});

test("Codex reconnects do not fail the run, but a failed turn reports its error", async (t) => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });
  let stopped = false;
  t.mock.method(Sandbox, "create", async () => ({
    runCommand: async ({ stdout, stderr }: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream }) => {
      stdout.write(JSON.stringify({ type: "error", message: "Reconnecting... 1/5" }) + "\n");
      stdout.write(JSON.stringify({ type: "turn.failed", error: { message: "Rate limit exceeded" } }));
      stderr.write("unhelpful generic error");
      return { exitCode: 1 };
    },
    stop: async () => { stopped = true; },
  }));
  const events: RunEvent[] = [];
  await runAgent("hello", (event) => events.push(event), new AbortController().signal, "codex");
  assert.ok(events.some((event) => event.type === "status" && event.text === "Reconnecting"));
  assert.deepEqual(events.filter((event) => event.type === "error" || event.type === "done"), [
    { type: "error", message: "Rate limit exceeded" },
    { type: "done", exitCode: 1 },
  ]);
  assert.equal(stopped, true);
});
