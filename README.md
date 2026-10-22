# Let me Claude / Codex that for you

lmgtfy for coding agents. Type the question, send the link. It types it into the agent for them.
With credentials set, it actually runs the agent in a Vercel Sandbox microVM and streams the answer.

TanStack Start + Vite + Tailwind + `@vercel/sandbox`.

```
npm i
npm run dev      # :3999
npm run build    # dist/
npm test
npm run typecheck
```

Switch between Claude and Codex at the top of the landing page without losing your question. Claude appears first and is selected by default.
The URL remembers the choice: `/?a=codex` or `/?a=claude`.
Generated links: `/go?a=<agent>&d=<base64url-question>&s=<signature>`.
Links without `a` default to Claude; legacy `/go?q=<question>` links still play the animation.

## Live runs

Without creds the share page fakes it. To run for real:

```
vercel login
vercel env pull          # -> .env.local with VERCEL_OIDC_TOKEN (12h)
```

Set `OPENAI_API_KEY` for Codex, `ANTHROPIC_API_KEY` for Claude, and a random `LINK_SECRET` in `.env.local`. Generate the
signing secret with `openssl rand -hex 32`. Never commit credentials.

Or durable: `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` (see `.env.example`).
Missing a direct provider key? Set `AI_GATEWAY_USE_OIDC=1` or `AI_GATEWAY_API_KEY` to route through
Vercel AI Gateway on the team's credits, using `/codex/v1` for Codex or `/claude-code` for Claude.
Model: `CODEX_MODEL`, default `gpt-5.1-codex-mini` for OpenAI or
`openai/gpt-5.1-codex-mini` for Gateway. Gateway overrides need the provider prefix.
Claude uses `CLAUDE_MODEL`, default `claude-haiku-4-5`.

How a run works (`src/server/run.ts`):
- boots `vercel/sandbox/universal`, 1 vCPU, non-persistent, agent killed after 60s
- egress allow-list is only the model API host; the real key is injected at the sandbox firewall, the VM only ever holds a placeholder
- runs `codex exec --json` in an ephemeral session, forwards completed messages and command activity over SSE (`/api/run`)
- or runs `claude -p` with streaming JSON, a six-turn limit, and a $0.25 budget
- links are HMAC-signed (`LINK_SECRET`) over both agent and question; unsigned links still play the bit but never get a VM. Older question-only signatures must be regenerated for live runs
- transcripts cached in Upstash Redis for 30 days under agent-specific keys; shared limits (per-IP, concurrent, daily; `RUN_*`) live there too, memory fallback without it

The landing-page Codex symbol and Claude mascot keep the original peek animation.
The favicon follows the selected agent on landing and share pages. Share pages never redirect automatically.
The final link opens the selected agent on the web; Codex does not support prefilling a task.

Codex has no equivalent to Claude Code's per-run dollar budget flag. The 60-second
timeout and run limits remain; use a provider or Gateway budget for a spend ceiling.
