export const AGENTS = {
  codex: {
    name: "OpenAI Codex",
    short: "Codex",
    cmd: "codex",
    promptChar: "›",
    color: "#a8e6cf",
    icon: "/icon.svg",
    banner: [">_ OpenAI Codex", "  /help for help"],
    webUrl: (_q: string) => "https://chatgpt.com/codex",
  },
  claude: {
    name: "Claude Code",
    short: "Claude",
    cmd: "claude",
    promptChar: ">",
    color: "#d97757",
    icon: "/claude.svg",
    banner: ["✻ Welcome to Claude Code!", "  /help for help"],
    webUrl: (q: string) => `https://claude.ai/new?q=${encodeURIComponent(q)}`,
  },
};

export type AgentId = keyof typeof AGENTS;

export function parseAgent(value: unknown): AgentId {
  if (value === undefined || value === null) return "claude";
  if (value === "codex" || value === "claude") return value;
  throw new Error("Unknown agent");
}

export const MAX_PROMPT = 2000;

function encodeQuestion(q: string): string {
  const bytes = new TextEncoder().encode(q);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeQuestion(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

export function parseShareQuestion(search: Record<string, unknown>): string {
  if (typeof search.d === "string") {
    try {
      return decodeQuestion(search.d).trim().slice(0, MAX_PROMPT);
    } catch {
      return "";
    }
  }
  return String(search.q ?? "").trim().slice(0, MAX_PROMPT);
}

export function buildSharePath(q: string, s = "", agent: AgentId = "claude") {
  const p = new URLSearchParams({ a: agent, d: encodeQuestion(q.trim().slice(0, MAX_PROMPT)) });
  if (s) p.set("s", s);
  return `/go?${p.toString()}`;
}
