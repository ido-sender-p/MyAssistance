# MyAssistance

Personal AI assistant for Ido — hosted on Cloudflare Pages under the `wildock` domain, powered by Claude.

## Project Goal

Build a personal assistant that knows Ido, his context, preferences, and tasks — and can act on his behalf across tools and services.

## Stack

- **Runtime:** Cloudflare Worker (main logic)
- **AI:** Workers AI binding — edge LLM inference
- **Database:** Cloudflare D1 — long-term memory, conversation history
- **Cache/State:** Cloudflare KV — sessions, fast ephemeral state
- **Frontend:** Cloudflare Pages — UI
- **Language:** TypeScript
- **Domain:** wildock.com
- **Repo:** https://github.com/ido-sender-p/MyAssistance

## Worker Bindings

| Binding | Type | Purpose |
|---|---|---|
| `AI` | Workers AI | LLM inference at edge |
| `DB` | D1 Database | Long-term memory + history |
| `CACHE` | KV Namespace | Sessions + fast state |

## Architecture

```
Browser (wildock.com)
    ↓
Cloudflare Pages (UI)
    ↓
Cloudflare Worker
    ├── AI     → Workers AI
    ├── DB     → D1 (memory)
    └── CACHE  → KV (sessions)
```

## Key Principles

- Assistant is personal — optimized for Ido's workflows, not generic use
- Memory is first-class — every meaningful interaction stored in D1
- Edge-first — all logic runs on Cloudflare Workers, no traditional servers
- Tool-use driven — Claude uses tools to act, not just respond

## Directory Structure (planned)

```
public/                    # Static frontend (Cloudflare Pages)
  index.html               # Chat UI
  assets/

functions/                 # Cloudflare Pages Functions (Workers)
  api/
    chat.ts                # POST /api/chat — main assistant endpoint
    memory.ts              # GET/POST /api/memory

src/                       # Shared logic
  assistant.ts             # Core Claude calls + tool orchestration
  memory/
    store.ts               # D1 read/write helpers
    schema.sql             # D1 schema
  tools/                   # Claude tool definitions + implementations
  config/
    prompts.ts             # System prompts

wrangler.toml              # Cloudflare config (D1, KV bindings, domain)
```

## Development

```bash
npm run dev          # Local dev with Wrangler Pages
npm run deploy       # Deploy to Cloudflare Pages
npm run db:migrate   # Run D1 migrations
```

## Domain

- Cloudflare Pages project connected to `wildock` domain
- Assistant lives at a path like `wildock.com/assistant` or subdomain `assistant.wildock.com`

## Claude API Usage

- Default model: `claude-sonnet-4-6`
- Use extended thinking for complex planning tasks
- Tool use for all side effects (memory write, external calls)
- System prompt lives in `src/config/prompts.ts`
