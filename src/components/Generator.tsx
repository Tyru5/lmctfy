import { useEffect, useState, useSyncExternalStore } from "react";
import { createServerFn } from "@tanstack/react-start";
import { AGENTS, MAX_PROMPT, buildSharePath, parseAgent, type AgentId } from "@/lib/agents";

const signQ = createServerFn()
  .inputValidator((d: { q: string; agent: AgentId }) => ({ q: d.q.trim().slice(0, MAX_PROMPT), agent: parseAgent(d.agent) }))
  .handler(async ({ data }) => (await import("@/server/sign")).sign(data.q, data.agent));

export default function Generator({ agentId }: { agentId: AgentId }) {
  const agent = AGENTS[agentId];
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const [sig, setSig] = useState<{ q: string; agent: AgentId; s: string } | null>(null);
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");

  const ready = q.trim().length > 0;
  // sign after typing pauses; the link updates once the signature lands
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const t = setTimeout(() => {
      const mine = q;
      signQ({ data: { q: mine, agent: agentId } }).then((s) => {
        if (!cancelled) setSig({ q: mine, agent: agentId, s });
      }).catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, ready, agentId]);
  const path = buildSharePath(q, sig?.q === q && sig.agent === agentId ? sig.s : "", agentId);
  const url = origin + path;

  async function copy() {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy:", url);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        copy();
      }}
      className="w-full max-w-xl mx-auto flex flex-col gap-4"
    >
      <div className="flex items-start gap-2 rounded-lg border border-line bg-elev px-4 py-3 font-mono text-sm focus-within:border-fg/40">
        <span style={{ color: agent.color }}>{agent.promptChar}</span>
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value.slice(0, MAX_PROMPT))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              copy();
            }
          }}
          rows={2}
          autoFocus
          aria-label="Question"
          className="flex-1 bg-transparent outline-none resize-none"
        />
      </div>

      <div className="flex gap-2">
        <input
          readOnly
          value={ready ? url : ""}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Link"
          className="flex-1 min-w-0 rounded-lg border border-line bg-elev px-3 py-2 font-mono text-sm text-muted focus:text-fg outline-none"
        />
        <button
          type="submit"
          disabled={!ready}
          className="rounded-lg px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          style={{ background: agent.color }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <a
          href={ready ? path : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!ready}
          className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg aria-disabled:opacity-40 aria-disabled:pointer-events-none"
        >
          Preview
        </a>
      </div>
    </form>
  );
}
