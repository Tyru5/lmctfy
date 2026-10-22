import type { AgentId } from "@/lib/agents";

export function PeekingMascot({ agentId }: { agentId: AgentId }) {
  return (
    <span className={`peeking-mascot peeking-mascot--${agentId}`} aria-hidden>
      {agentId === "codex" ? (
        <img src="/icon.svg" alt="" width={24} height={24} />
      ) : (
        <svg viewBox="0 0 18 6" preserveAspectRatio="none" shapeRendering="crispEdges">
          <g fill="#DD775B">
            <rect x="4" y="4" width="1" height="1" />
            <rect x="6" y="4" width="1" height="1" />
            <rect x="11" y="4" width="1" height="1" />
            <rect x="13" y="4" width="1" height="1" />
            <rect x="3" y="0" width="12" height="2" />
            <rect x="1" y="2" width="16" height="1" />
            <rect x="3" y="3" width="12" height="1" />
          </g>
          <g className="mascot-eyes" fill="#0a0a0b">
            <rect x="5" y="1" width="1" height="1" />
            <rect x="12" y="1" width="1" height="1" />
          </g>
        </svg>
      )}
    </span>
  );
}
