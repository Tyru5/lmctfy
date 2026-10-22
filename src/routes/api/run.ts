import { createFileRoute } from "@tanstack/react-router";
import { MAX_PROMPT, parseAgent, type AgentId } from "@/lib/agents";
import type { RunEvent } from "@/server/run";

export const Route = createFileRoute("/api/run")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { runAgent, isLive } = await import("@/server/run");
        const { acquire, release, getCached, setCached } = await import("@/server/store");
        const { verify } = await import("@/server/sign");

        const sp = new URL(request.url).searchParams;
        let agent: AgentId;
        try { agent = parseAgent(sp.get("a")); }
        catch { return new Response("unknown agent", { status: 400 }); }
        const q = (sp.get("q") ?? "").trim().slice(0, MAX_PROMPT);
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";

        if (!q) return new Response("missing q", { status: 400 });
        if (!verify(q, sp.get("s") ?? undefined, agent)) return new Response("unsigned link", { status: 403 });
        if (!(await isLive(agent))) return new Response("not configured", { status: 503 });

        const enc = new TextEncoder();
        const sse = (e: unknown) => enc.encode(`data: ${JSON.stringify(e)}\n\n`);
        const headers = {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        };

        // Same question already answered: replay, no VM.
        const cached = await getCached(q, agent);
        if (cached) {
          const body = cached.map(sse).concat(sse({ type: "done", exitCode: 0, cached: true }));
          return new Response(new Blob(body as BlobPart[]), { headers });
        }

        const denied = await acquire(ip);
        if (denied) return new Response(denied, { status: 429 });

        const stream = new ReadableStream({
          async start(controller) {
            const transcript: RunEvent[] = [];
            let ok = true;
            const send = (e: RunEvent) => {
              if (e.type === "error") ok = false;
              if (e.type === "text" || e.type === "tool") transcript.push(e);
              try { controller.enqueue(sse(e)); } catch {}
            };
            const ping = setInterval(() => { try { controller.enqueue(enc.encode(": ping\n\n")); } catch {} }, 15_000);
            try {
              await runAgent(q, send, request.signal, agent);
              if (ok && transcript.some((e) => e.type === "text")) await setCached(q, transcript, agent);
            } catch (err) {
              send({ type: "error", message: err instanceof Error ? err.message.slice(0, 200) : "failed" });
              send({ type: "done", exitCode: 1 });
            } finally {
              clearInterval(ping);
              await release();
              try { controller.close(); } catch {}
            }
          },
        });
        return new Response(stream, { headers });
      },
    },
  },
});
