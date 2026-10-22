import { Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { Sandbox, type NetworkPolicy } from "@vercel/sandbox";
import { getVercelOidcToken } from "@vercel/oidc";
import type { AgentId } from "@/lib/agents";

export type RunEvent =
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; text: string }
  | { type: "done"; exitCode: number }
  | { type: "error"; message: string };

const MODEL = () => process.env.CODEX_MODEL || "gpt-5.1-codex-mini";

/** OIDC token: `.env.local` locally, request header on Vercel. Empty when neither is present. */
async function oidcToken(): Promise<string> {
  try {
    return await getVercelOidcToken();
  } catch {
    return "";
  }
}

/** AI Gateway credential: explicit key, or the OIDC token when opted in (team needs gateway credits). */
async function gatewayKey(): Promise<string> {
  return process.env.AI_GATEWAY_API_KEY || (process.env.AI_GATEWAY_USE_OIDC ? await oidcToken() : "");
}

/** The firewall injects auth; the VM never sees the key. */
async function broker(agent: AgentId): Promise<{ domain: string; baseUrl: string; model: string; headers: Record<string, string> } | null> {
  if (agent === "claude") {
    const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
    if (process.env.ANTHROPIC_API_KEY)
      return {
        domain: "api.anthropic.com",
        baseUrl: "https://api.anthropic.com",
        model,
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY },
      };
    const key = await gatewayKey();
    return key ? {
      domain: "ai-gateway.vercel.sh",
      baseUrl: "https://ai-gateway.vercel.sh/claude-code",
      model,
      headers: { authorization: `Bearer ${key}` },
    } : null;
  }
  if (process.env.OPENAI_API_KEY)
    return {
      domain: "api.openai.com",
      baseUrl: "https://api.openai.com/v1",
      model: MODEL(),
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    };
  const key = await gatewayKey();
  if (key)
    return {
      domain: "ai-gateway.vercel.sh",
      baseUrl: "https://ai-gateway.vercel.sh/codex/v1",
      model: process.env.CODEX_MODEL || `openai/${MODEL()}`,
      headers: { authorization: `Bearer ${key}` },
    };
  return null;
}

async function hasVercelAuth() {
  const e = process.env;
  return Boolean((e.VERCEL_TOKEN && e.VERCEL_TEAM_ID && e.VERCEL_PROJECT_ID) || (await oidcToken()));
}

export const isLive = async (agent: AgentId = "claude") => (await hasVercelAuth()) && (await broker(agent)) !== null;

const text = (t: string): RunEvent[] => (t ? [{ type: "text", text: t }] : []);

function parse(line: string, agent: AgentId): RunEvent[] {
  let j: any;
  try { j = JSON.parse(line); } catch { return []; }
  if (agent === "claude") {
    if (j.type === "stream_event" && j.event?.type === "content_block_delta" && j.event.delta?.type === "text_delta")
      return text(j.event.delta.text);
    if (j.type === "assistant")
      return (j.message?.content ?? [])
        .filter((c: any) => c.type === "tool_use")
        .map((c: any) => ({ type: "tool", text: `${c.name}(${summarize(c.input)})` }));
    if (j.type === "result" && j.is_error) return [{ type: "error", message: String(j.result ?? "failed") }];
    return [];
  }
  if (j.type === "item.completed" && j.item?.type === "agent_message" && typeof j.item.text === "string")
    return text(j.item.text + "\n");
  if (j.type === "item.started" && j.item?.type === "command_execution")
    return [{ type: "tool", text: `$ ${j.item.command}` }];
  if (j.type === "error" && /^Reconnecting/.test(String(j.message ?? "")))
    return [{ type: "status", text: "Reconnecting" }];
  if (j.type === "turn.failed" || j.type === "error")
    return [{ type: "error", message: String(j.error?.message ?? j.message ?? "failed") }];
  return [];
}

function summarize(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const v = Object.values(input as Record<string, unknown>)[0];
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

export async function runAgent(q: string, emit: (e: RunEvent) => void, signal: AbortSignal, agent: AgentId = "claude"): Promise<void> {
  const b = await broker(agent);
  if (!b) return emit({ type: "error", message: "not configured" });

  const policy: NetworkPolicy = { allow: { [b.domain]: [{ transform: [{ headers: b.headers }] }] } };
  const env: Record<string, string> = agent === "codex"
    ? { CODEX_API_KEY: "firewall-placeholder", CODEX_HOME: "/tmp/lmctfy-codex" }
    : {
      ANTHROPIC_API_KEY: b.domain === "api.anthropic.com" ? "firewall-placeholder" : "",
      ANTHROPIC_AUTH_TOKEN: b.domain === "api.anthropic.com" ? "" : "firewall-placeholder",
      ANTHROPIC_BASE_URL: b.baseUrl,
      DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    };

  emit({ type: "status", text: "Booting a VM" });
  const sandbox = await Sandbox.create({
    image: "vercel/sandbox/universal", // ships both CLIs
    persistent: false,
    resources: { vcpus: 1 },
    timeout: 90_000,
    env,
    networkPolicy: policy,
  });

  try {
    if (signal.aborted) return;
    // Universal images start in /vercel; the agent workspace is not pre-created.
    await sandbox.mkDir("/vercel/sandbox");
    emit({ type: "status", text: "Running" });

    let buf = "";
    const decoder = new StringDecoder("utf8");
    let failed = false;
    const out = (e: RunEvent) => {
      if (e.type === "error") failed = true;
      emit(e);
    };
    const sink = new Writable({
      write(chunk, _enc, cb) {
        buf += decoder.write(chunk);
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) for (const e of parse(l, agent)) out(e);
        cb();
      },
    });
    let err = "";
    const errSink = new Writable({ write(c, _e, cb) { err += c.toString(); cb(); } });

    const cmd = await sandbox.runCommand({
      cmd: agent,
      cwd: "/vercel/sandbox",
      args: agent === "claude" ? [
        "-p", q, "--model", b.model,
        "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        "--max-turns", "6", "--max-budget-usd", "0.25", "--dangerously-skip-permissions",
      ] : [
        "exec", "--json", "--skip-git-repo-check", "--ephemeral",
        "--dangerously-bypass-approvals-and-sandbox",
        "--model", b.model,
        "-c", 'model_provider="brokered"',
        "-c", 'model_providers.brokered.name="Brokered Codex"',
        "-c", `model_providers.brokered.base_url=${JSON.stringify(b.baseUrl)}`,
        "-c", 'model_providers.brokered.env_key="CODEX_API_KEY"',
        "-c", 'model_providers.brokered.wire_api="responses"',
        "--", q,
      ],
      stdout: sink,
      stderr: errSink,
      signal,
      timeoutMs: 60_000,
    });
    buf += decoder.end();
    if (buf) for (const e of parse(buf, agent)) out(e);
    if (cmd.exitCode !== 0 && !failed)
      emit({ type: "error", message: cmd.exitCode === 137 ? "took longer than a minute" : err.trim().split("\n").pop()?.slice(0, 200) || `exit ${cmd.exitCode}` });
    emit({ type: "done", exitCode: cmd.exitCode });
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
