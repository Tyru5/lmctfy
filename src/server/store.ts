import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { RunEvent } from "@/server/run";
import type { AgentId } from "@/lib/agents";

const num = (k: string, d: number) => Number(process.env[k]) || d;
const CACHE_TTL = 60 * 60 * 24 * 30;

let redis: Redis | null | undefined;
function db(): Redis | null {
  if (redis === undefined) {
    // Vercel Marketplace injects KV_REST_API_*; plain Upstash uses UPSTASH_REDIS_REST_*
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    redis = url && token ? new Redis({ url, token }) : null;
  }
  return redis;
}
export const durable = () => db() !== null;

const key = (q: string, agent: AgentId) => `run:${agent}:${createHash("sha256").update(q).digest("hex").slice(0, 32)}`;

// ---- transcript cache: one VM per question, ever ---------------------------
const mem = new Map<string, RunEvent[]>();

export async function getCached(q: string, agent: AgentId = "claude"): Promise<RunEvent[] | null> {
  const r = db();
  if (!r) return mem.get(key(q, agent)) ?? null;
  return (await r.get<RunEvent[]>(key(q, agent))) ?? null;
}

export async function setCached(q: string, events: RunEvent[], agent: AgentId = "claude"): Promise<void> {
  const r = db();
  if (!r) return void mem.set(key(q, agent), events);
  await r.set(key(q, agent), events, { ex: CACHE_TTL });
}

// ---- limits: per-IP window, global concurrency, daily cap -------------------
// Redis-backed when provisioned; per-instance memory otherwise (dev).
const memIp = new Map<string, number[]>();
let memRunning = 0;
let memDay = "";
let memToday = 0;

export async function acquire(ip: string): Promise<string | null> {
  const perIp = num("RUN_PER_IP", 3);
  const windowMs = num("RUN_WINDOW_MS", 600_000);
  const maxConc = num("RUN_MAX_CONCURRENT", 3);
  const daily = num("RUN_DAILY_CAP", 100);
  const day = new Date().toISOString().slice(0, 10);
  const r = db();

  if (!r) {
    const now = Date.now();
    const hits = (memIp.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= perIp) return "Slow down. Try again in a few minutes.";
    if (memRunning >= maxConc) return "Too many people asking right now.";
    if (memDay !== day) (memDay = day), (memToday = 0);
    if (memToday >= daily) return "Out of runs for today.";
    hits.push(now);
    memIp.set(ip, hits);
    memRunning++;
    memToday++;
    return null;
  }

  const ipKey = `ip:${ip}`;
  const hits = await r.incr(ipKey);
  if (hits === 1) await r.pexpire(ipKey, windowMs);
  if (hits > perIp) return "Slow down. Try again in a few minutes.";

  const dayKey = `day:${day}`;
  const today = await r.incr(dayKey);
  if (today === 1) await r.expire(dayKey, 60 * 60 * 48);
  if (today > daily) return "Out of runs for today.";

  const running = await r.incr("running");
  await r.expire("running", 180); // self-heals if a release is ever lost
  if (running > maxConc) {
    await r.decr("running");
    return "Too many people asking right now.";
  }
  return null;
}

export async function release(): Promise<void> {
  const r = db();
  if (!r) return void (memRunning = Math.max(0, memRunning - 1));
  const n = await r.decr("running");
  if (n < 0) await r.set("running", 0);
}
