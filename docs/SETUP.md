# SETUP.md — everything needed before and during the build

Companion to `SPEC.md` (what to build) and `DESIGN_BRIEF.md` (how it looks). This is the operational checklist: the accounts, keys and decisions each phase depends on, in the order they're needed. Tick items off as they're done; log anything decision-shaped in `DECISIONS.md`.

Two tracks run in parallel right now:

- **Design** — Joshua is producing screens in Claude Design from `DESIGN_BRIEF.md` §9 (the paste-in prompt). The build doesn't block on this: Phase 0 is plumbing (schema, auth, PWA, push, jobs), and the design lands with Phase 1's screens. Export/share the finished screens so build sessions can reference them.
- **Build prerequisites** — the checklist below. Everything in "Before Phase 0" should exist before the first build session, so the session is spent building rather than clicking through consoles.

---

## Before Phase 0 (do these first)

### 1. Decide the app's domain name — **the one true blocker**

SPEC §13.3: iOS push wants a stable origin from day one, and Google OAuth redirect URIs (Phase 3) are registered against it. Changing origin later means re-installing the PWA and re-registering push on the phone. Suggested shape: `os.<yourdomain>.com` or a new ~$12/year domain. **Decide before Phase 0 finishes; log it in DECISIONS.md.**

### 2. Create the Supabase project

At [supabase.com](https://supabase.com) (free tier), create a project (region close to New York, e.g. `us-east-1`). Collect into your env file:

- [ ] `NEXT_PUBLIC_SUPABASE_URL` — Project Settings → API
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same page
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — same page (server-only; never exposed to the client)
- [ ] Enable the `pg_cron` and `pg_net` extensions (Database → Extensions) — scheduled jobs depend on both
- [ ] Create the single user (Authentication → Users → "Add user", email + password). There is no signup page by design.

### 3. Create the Vercel project

At [vercel.com](https://vercel.com) (Hobby tier):

- [ ] Import the `joshxnyc/lifeos` GitHub repo (git push = deploy)
- [ ] Attach the domain from step 1; set `APP_URL` to it
- [ ] Environment variables get pasted here once the full set below exists

### 4. API keys

- [ ] `OPENROUTER_API_KEY` — [openrouter.ai](https://openrouter.ai/keys). The single LLM key (Joshua's decision, 2026-09-15): Claude Sonnet via OpenRouter for extraction/filing/coach, Claude Haiku for cleanup, Gemini Flash for voice transcription. Expect ~$3–8/month plus OpenRouter's ~5% fee.
- [ ] `OPENAI_API_KEY` — optional. OpenRouter has no Whisper endpoint, so transcription runs through an audio-capable chat model. If browser-recorded audio (Safari `audio/mp4`, Chrome `audio/webm`) ever transcribes poorly through OpenRouter, set this and direct Whisper takes over transcription automatically.

### 5. Generate secrets (one terminal session)

```bash
# 32-byte key for encrypting OAuth tokens at rest
openssl rand -base64 32        # → TOKEN_ENCRYPTION_KEY

# shared secret pg_cron sends to /api/jobs/*
openssl rand -hex 32           # → JOBS_SECRET

# Web Push VAPID key pair
npx web-push generate-vapid-keys   # → VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
# VAPID_SUBJECT = mailto:joshxnyc@gmail.com
```

- [ ] `TOKEN_ENCRYPTION_KEY`
- [ ] `JOBS_SECRET`
- [ ] `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`
- [ ] `APP_TIMEZONE=America/New_York`

### 6. Local tooling (for build sessions)

- [ ] Node.js 20+ and `pnpm`
- [ ] Supabase CLI (`brew install supabase/tap/supabase`) — migrations run through it
- [ ] Confirm times or accept defaults: morning brief 07:00 · evening close-out 21:00 · weekly review Sunday 17:00 · quiet hours 23:00–06:30 (all changeable in Settings later)

**Phase 0 is buildable once steps 1–5 are done.** Its live-in-it test: app installed on the iPhone home screen and on the Mac, and a test push arrives on the phone.

### 7. After the first deploy: run migrations and point pg_cron at the app

```bash
# from the repo, with the Supabase CLI linked to the project
supabase link --project-ref <ref>
supabase db push          # applies /supabase/migrations
```

Then in the Supabase SQL editor, tell the cron jobs where the app lives
(they read this at call time — see `supabase/migrations/20260915000002_cron.sql`):

```sql
insert into private.app_config (key, value) values
  ('app_url', 'https://<your-domain>'),
  ('jobs_secret', '<JOBS_SECRET value>')
on conflict (key) do update set value = excluded.value;
```

Finally create your user (Authentication → Add user) — this auto-seeds the
four domains and default settings via a trigger.

---

## Before Phase 3 (Google accounts, archive, extraction)

Phases 1–2 need nothing external beyond the list above. Phase 3 needs the Google Cloud setup — worth doing during Phase 2, since the consent-screen settings take a little care:

- [ ] Create one Google Cloud project; enable the **Gmail API** and **Google Calendar API**
- [ ] OAuth consent screen: External. Scopes: `openid`, `email`, `gmail.readonly`, `calendar` — read-only Gmail, never `gmail.modify` or send (standing rule, CLAUDE.md §4)
- [ ] **Publish the consent screen to "In production"** (unverified is fine for personal use). In *Testing* status refresh tokens die every 7 days — the known gotcha in SPEC §6.1. Log the outcome in DECISIONS.md; if Google blocks the unverified app on the restricted Gmail scope, the fallback (stay in Testing + a token-expiry alert job) is specced.
- [ ] OAuth client (Web application). Redirect URIs: `https://<domain>/api/auth/google/callback` and `http://localhost:3000/api/auth/google/callback` → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- [ ] Both accounts ready to connect: personal Gmail and the Tarifa Google account

## Before Phase 4 (Notion mirror, Granola)

- [ ] **Answer: which Granola plan?** Basic → MCP adapter, summaries only, 30-day window; Business → API adapter with transcripts (`GRANOLA_API_KEY`). (SPEC §13.1)
- [ ] **Answer: which Tarifa Notion databases/pages to mirror**, and which property means "done" (SPEC §13.2)
- [ ] Create a Notion **internal integration** at notion.so/my-integrations (read-only capabilities suffice — the app never writes to Notion) → `NOTION_TOKEN`; share the chosen Tarifa pages/databases with it from Notion's UI

## Optional, any time

- [ ] Pushover account (`PUSHOVER_USER_KEY`, `PUSHOVER_APP_TOKEN`) — fallback channel only if iOS Web Push proves flaky

---

## Build order (recap from SPEC §10)

| Phase | Ships | External deps | Live-in-it test |
| :---- | :---- | :---- | :---- |
| 0 | Repo, full schema, auth, PWA + push, app shell, jobs scaffold | Steps 1–5 above | Installed on iPhone + Mac, test push arrives |
| 1 | Tasks, projects, voice/text capture, notes, search, export | — (uses Anthropic + OpenAI keys) | All personal tasks live here; daily voice capture; no other task tool for a week |
| 2 | Routines, streaks, all daily notifications | — | Gym/vitamins/morning routine tracked 2 weeks, pushes reliable |
| 3 | Google multi-account, Gmail/Calendar sync, archive, extraction queue | Google Cloud section | Both accounts connected; queue cleared each morning; ≥1 real save |
| 4 | Notion mirror, Granola ingestion | Notion + Granola section | Tarifa items visible; a meeting produced a correct suggestion within an hour |
| 5 | People, full archive search | — | "What do I owe Bernhard?" in one tap; month-old email findable |
| 6 | Top-item proposal, weekly review + coach | — | Two consecutive reviews done; coach read rang true |

Rules that bind every session (from SPEC): build phase by phase, **never ahead**; stop at each phase end for a few days of real use; full schema is created in Phase 0 so later phases never migrate data; `pnpm typecheck && pnpm lint && pnpm test` green before a phase is called done.
