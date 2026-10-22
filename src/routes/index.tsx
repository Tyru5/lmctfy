import { createFileRoute } from "@tanstack/react-router";
import Generator from "@/components/Generator";
import { PeekingMascot } from "@/components/Mascot";
import { AGENTS, parseAgent } from "@/lib/agents";

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>) => ({ a: parseAgent(s.a) }),
  head: ({ match }) => ({
    meta: [
      { title: `Let me ${AGENTS[match.search.a].short} that for you` },
      {
        name: "description",
        content:
          "For all those people who find it more convenient to bother you with their question rather than ask the agent themselves.",
      },
    ],
    links: [{ rel: "icon", type: "image/svg+xml", href: AGENTS[match.search.a].icon }],
  }),
  component: Home,
});

function Home() {
  const { a: agentId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const agent = AGENTS[agentId];
  return (
    <>
      <nav aria-label="Agent variant" className="mx-auto mt-6 flex gap-3">
        {(["claude", "codex"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={agentId === id}
            onClick={() => navigate({ search: { a: id }, replace: true })}
            className="px-1 py-2 text-xs text-muted hover:text-fg aria-pressed:text-fg aria-pressed:underline decoration-line underline-offset-8 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-fg"
          >
            {AGENTS[id].short}
          </button>
        ))}
      </nav>
      <main data-agent={agentId} className="flex-1 flex flex-col items-center justify-center px-4 py-16 gap-10">
        <header className="text-center max-w-xl">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
            Let me{" "}
            <span className="agent-word">
              <PeekingMascot key={agentId} agentId={agentId} />
              <span className="shimmer">{agent.short}</span>
            </span>{" "}
            that for you
          </h1>
          <p className="mt-4 text-muted">
            For all those people who find it more convenient to bother you with their question
            rather than ask the agent themselves.
          </p>
        </header>
        <Generator agentId={agentId} />
      </main>
    </>
  );
}
