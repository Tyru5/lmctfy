import { createHmac, timingSafeEqual } from "node:crypto";
import type { AgentId } from "@/lib/agents";

const secret = () => process.env.LINK_SECRET || "";

/** Bind the question to its agent so editing a link cannot switch live runners. */
export function sign(q: string, agent: AgentId = "claude"): string {
  if (!secret()) return "";
  return createHmac("sha256", secret()).update(JSON.stringify([agent, q])).digest("base64url").slice(0, 24);
}

export function verify(q: string, s: string | undefined, agent: AgentId = "claude"): boolean {
  const want = sign(q, agent);
  if (!want || !s || s.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(s), Buffer.from(want));
}
