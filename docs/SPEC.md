# LifeOS — Build Spec for Claude Code

Working name: **LifeOS** (rename freely; nothing depends on it). Owner: Joshua Sta Ana. Single user. Version 1.0 of this spec, 15 Sept 2026\.

> **How to use this document (read first, Claude Code):** This is the source of truth for what to build and in what order. Build **phase by phase**, in order, and stop at the end of each phase for Joshua to use it for a few days before starting the next. Do not build ahead. Every design decision below was made deliberately in conversation; if you think one is wrong, say so and ask before deviating. When something is unspecified, prefer the simplest thing that keeps the data model intact. Put a copy of this file at `/docs/SPEC.md` in the repo, and keep a `/docs/DECISIONS.md` log of anything you decide that this spec left open.

---

## 1\. Purpose

A personal "life operating system" that runs on Joshua's phone and laptop as an installable PWA. It is the **single source of truth for every task that is his alone**, across four domains (Personal, Almedia, Tarifa, Misc). It connects to his email, calendars, meeting notes and Notion, has AI read them to extract commitments and deadlines into a review queue, tracks routines with streaks and push notifications, and runs a guided weekly review that ends with an honest coaching read based on real numbers.

The problem it solves: slippage. Things get promised in an email or a meeting and are forgotten; routines fade without nudges; projects go dormant without anyone noticing. Every feature exists to close one of those gaps.

Reference model: Jerad Hill's Claude Code-built life app (Node \+ Supabase \+ PWA \+ Claude API \+ push). This spec is more integration-heavy than his (email, Notion, Granola ingestion) and adds a coaching layer.

### Design principles (do not violate)

1. **One system of record for personal tasks.** Anything that is Joshua's alone lives here and nowhere else. Anything involving other people (currently: Tarifa work shared with Bernhard in Notion) is *mirrored in*, read-only, with a link back to the source. The app never becomes a fifth place to check.  
2. **Archive everything the app touches.** Every email thread, calendar event, Notion page and Granola note the app reads gets a copy in our own database (`source_items`). This powers search and extraction, and means losing access to any external service loses nothing historical.  
3. **AI proposes, Joshua disposes.** Extracted commitments go into a review queue with accept/dismiss. Nothing auto-creates a task from external data. (Captures Joshua dictates himself *do* auto-file, since he authored them.)  
4. **Honest numbers over badges.** Gamification means streaks, completion rates, and a weekly coaching read that names the uncomfortable pattern. No points, levels, or confetti.  
5. **Ship a usable core first.** Each phase ends in a state Joshua can live in. Integrations layer on afterwards.  
6. **Unlimited accounts.** Connected accounts are rows in a table, not config. Adding a third Google account is a button, not a code change.

---

## 2\. Scope

### In scope for v1 (all six phases)

- Domains → Projects/Areas → Tasks hierarchy  
- Task CRUD with due dates, priorities, recurrence, project and person links  
- Voice capture (real audio recording on phone) and text capture, AI-transcribed, cleaned and auto-filed  
- Today screen: list across domains \+ a proposed top item for the day  
- Routines with reminder times, grace windows, missed nudges, streaks, rolling completion rates  
- Push notifications: morning brief, routine reminders, missed-routine nudges, evening close-out, weekly review prompt, review-queue digest  
- Any number of Google accounts: Gmail (read) and Google Calendar (read \+ write to a designated calendar per account)  
- Notion (Tarifa workspace): read-only mirror of tasks/notes with links out  
- Granola: ingest meeting notes (and transcripts where the plan allows) into the archive  
- Hourly AI extraction sweep → review queue (accept/dismiss)  
- Notes (markdown), attachable to a project, a person, or standalone  
- People: relationship hub with owed/owing tasks, linked notes and source items, last-contact tracking  
- Keyword search across tasks, notes, people and the archive  
- Guided weekly review (scorecard → slipped → dormant → ahead → coach)

### Explicitly out of scope for v1

- Journal, quotes, book/reading tracker, content pipeline (Jerad has these; Joshua said no for now)  
- Almedia integrations (unknown stack; the Almedia domain exists for manual tasks only until Phase 7\)  
- Two-way Notion sync (read-only only; revisit only if Joshua asks)  
- Semantic/vector search and "chat with my data" (Phase 8 candidate; keyword search in v1)  
- Apple Watch capture, share-sheet capture (iOS PWAs cannot be share targets)  
- Multi-user, sharing, collaboration of any kind  
- Native iOS/Android apps

---

## 3\. Stack and infrastructure

| Layer | Choice | Why |
| :---- | :---- | :---- |
| Frontend \+ API | **Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui** | One codebase, PWA-friendly, Claude Code is fluent in it |
| PWA | `@serwist/next` (service worker), web app manifest, `standalone` display | Installable on iOS home screen; required for iOS push |
| Database / Auth / Storage | **Supabase** (Postgres, Auth, Storage, pg\_cron, pg\_net) | Free tier covers this; Row Level Security scoped to the single user |
| Hosting | **Vercel** (Hobby tier) | Free; git push deploys |
| Scheduled jobs | **Supabase `pg_cron` \+ `pg_net`** calling Next.js route handlers under `/api/jobs/*` with a shared secret header | Vercel Hobby crons are limited to once per day; pg\_cron is free and can run hourly/minutely |
| LLM | **Anthropic API** — `claude-sonnet-4-5` (or current Sonnet) for extraction, filing, coach; Haiku for cheap classification if needed | Structured outputs via tool use |
| Transcription | **OpenAI `gpt-4o-transcribe`** (fallback `whisper-1`) | Cheap, handles Safari's audio/mp4 |
| Push | **Web Push (VAPID)** via the `web-push` npm package | Native iOS 16.4+ support for home-screen web apps; no Pushover needed. Keep Pushover as an optional fallback channel behind a settings toggle if iOS push proves flaky |
| Email/Calendar | Google APIs (`googleapis` npm), OAuth 2.0 per account |  |
| Notion | Notion API via internal integration token |  |
| Granola | Granola MCP server (`https://mcp.granola.ai/mcp`, OAuth 2.0 with DCR, Streamable HTTP) via `@modelcontextprotocol/sdk` client, **or** the Granola Public API (`https://public-api.granola.ai/v1`, bearer `grn_` key) if on a Business plan | See §6.4 |
| Search | Postgres full-text (`tsvector` \+ GIN) | Free, good enough for v1 |
| Encryption | OAuth tokens encrypted at rest with `pgsodium` or app-level AES-GCM using a `TOKEN_ENCRYPTION_KEY` env var | Never store refresh tokens in plaintext |

Expected running cost: Vercel $0, Supabase $0 (upgrade to Pro $25 only if you hit limits), Anthropic \~$3–8/month at hourly sweeps, transcription \<$1/month. Domain \~$12/year.

### Environment variables (create `.env.example` in Phase 0\)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TOKEN_ENCRYPTION_KEY=            # 32 bytes base64
JOBS_SECRET=                     # shared secret for /api/jobs/*
ANTHROPIC_API_KEY=
OPENAI_API_KEY=                  # transcription only
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NOTION_TOKEN=                    # internal integration
GRANOLA_API_KEY=                 # only if Business plan; otherwise MCP OAuth tokens live in connected_accounts
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:...
PUSHOVER_USER_KEY=               # optional fallback
PUSHOVER_APP_TOKEN=              # optional fallback
APP_URL=
APP_TIMEZONE=America/New_York
```

### Auth

Single user. Supabase Auth with email \+ password (magic link optional). One `users` row; every table has `user_id` and RLS `user_id = auth.uid()`. There is no signup page — the user is created via the Supabase dashboard. Server-side jobs use the service role key.

---

## 4\. Data model

Postgres via Supabase migrations (`/supabase/migrations/*.sql`). All tables have `id uuid pk default gen_random_uuid()`, `user_id uuid`, `created_at`, `updated_at`. Only non-obvious columns listed.

### 4.1 Structure

**domains** — `name`, `slug` (`personal | almedia | tarifa | misc`), `color`, `sort_order`, `is_placeholder` (Almedia \= true until integrations exist). Seeded in Phase 0\.

**projects** — `domain_id`, `kind` (`project | area`), `name`, `description`, `status` (`active | parked | done`), `target_date` (projects only; areas are ongoing), `last_activity_at` (bumped by any task/note/capture touching it — used for dormancy), `notion_url` (for mirrored Tarifa projects), `sort_order`.

### 4.2 Work

**tasks** — `domain_id`, `project_id?`, `person_id?`, `title`, `body_md?`, `status` (`open | done | dropped`), `priority` (`0 none | 1 low | 2 med | 3 high`), `due_date?`, `due_time?`, `scheduled_date?` (the day Joshua intends to do it; distinct from due), `completed_at?`, `dropped_reason?`, `recurrence_rule?` (RFC 5545 RRULE string; on completion, spawn the next occurrence), `owner` (`me | them` — `me` is something Joshua must do; `them` is something someone else owes him, which the app tracks as a follow-up; requires `person_id` when `them`), `origin` (`manual | capture | suggestion | notion_mirror`), `origin_id?` (capture id / suggestion id / notion page id), `source_item_id?` (the email/meeting it came from, for the "why does this exist" link), `calendar_event_id?` (if time-blocked), `is_mirror` (true for Tarifa Notion items; read-only in UI, shows external link, cannot be completed here), `sort_order`.

**routines** — `domain_id?`, `name`, `emoji?`, `schedule_days` (int\[\] 0–6), `reminder_time` (time), `grace_minutes` (default 120), `nudge_enabled` (bool), `active`, `write_to_calendar` (bool, Phase 3), `sort_order`.

**routine\_logs** — `routine_id`, `date`, `status` (`done | missed | skipped`), `completed_at?`. Unique `(routine_id, date)`. "Skipped" is an explicit choice (travel day, sick) and does not break a streak; "missed" does. A nightly job writes `missed` for any scheduled routine with no log by end of day.

**captures** — `raw_text?`, `audio_path?` (Supabase Storage), `transcript?`, `cleaned_text?`, `status` (`pending | transcribing | filing | done | failed`), `result` (jsonb: what the AI created — task ids, note ids, person updates), `error?`, `source` (`phone_voice | phone_text | desktop_text | desktop_voice`).

**suggestions** — the review queue. `kind` (`task | deadline_change | follow_up | person_fact | project_update`), `title`, `detail`, `proposed` (jsonb — e.g. `{domain_id, project_id, person_id, due_date, priority}`), `evidence` (text excerpt from the source), `source_item_id`, `confidence` (0–1), `status` (`pending | accepted | dismissed | expired`), `resolved_at?`, `resulting_task_id?`, `dedupe_key` (hash of normalized title \+ due \+ person, to avoid re-suggesting the same thing every hour).

**daily\_plans** — `date` (unique), `proposed_top_task_ids` (uuid\[\]), `proposal_reason` (text), `chosen_top_task_id?`, `top3_task_ids?` (uuid\[\]), `brief_sent_at?`, `closeout_sent_at?`.

### 4.3 Knowledge

**notes** — `title`, `body_md`, `domain_id?`, `project_id?`, `person_id?`, `pinned`, `search_vector` (generated tsvector).

**people** — `name`, `emails` (text\[\]), `phone?`, `company?`, `role?`, `domain_id?`, `relationship?` (free text: "Tarifa principal", "roommate", "founder — Juicy Energy"), `notes_md?`, `last_contact_at` (max of: any source\_item they participated in, any completed task linked to them, manual "logged contact"), `follow_up_every_days?` (if set, the app nudges when `now - last_contact_at > follow_up_every_days`), `next_follow_up_at?`, `tags` (text\[\]), `search_vector`.

**people\_source\_items** — join: `person_id`, `source_item_id`, `role` (`from | to | cc | attendee | mentioned`). Populated automatically by matching emails/attendees; `mentioned` populated by the extraction sweep when it identifies a known person by name in a transcript.

### 4.4 Integration layer

**connected\_accounts** — `provider` (`google | notion | granola`), `label` ("Personal Gmail", "Tarifa Gmail"), `external_identity` (email / workspace name), `default_domain_id` (items from this account default to this domain — Tarifa Gmail → Tarifa), `access_token_enc`, `refresh_token_enc`, `token_expires_at`, `scopes` (text\[\]), `sync_state` (jsonb: e.g. Gmail `historyId`, Calendar `syncToken` per calendar, Notion `last_edited_time` cursor, Granola `created_after` cursor), `writable_calendar_id?` (Google only — the one calendar the app may create events in), `read_calendar_ids` (text\[\]), `status` (`active | needs_reauth | disabled`), `last_synced_at`, `last_error?`.

**source\_items** — the archive. `account_id`, `provider`, `kind` (`email_thread | calendar_event | notion_page | granola_note`), `external_id`, `external_url`, `title`, `text` (cleaned plain text — for email threads, the full thread with quoted replies stripped; for Granola, summary \+ transcript), `raw` (jsonb, full API payload), `participants` (jsonb: `[{name, email, role}]`), `occurred_at`, `fetched_at`, `content_hash`, `extraction_status` (`pending | done | skipped | failed`), `extracted_at?`, `domain_id?` (from account default, overridable), `search_vector`. Unique `(provider, external_id)`. Re-fetch updates `text/raw` and resets `extraction_status` only if `content_hash` changed.

**calendar\_events** — a cache of calendar reads plus a record of app writes. `account_id`, `calendar_id`, `external_id`, `title`, `starts_at`, `ends_at`, `all_day`, `attendees` (jsonb), `location?`, `html_link`, `task_id?` (if this block was created from a task), `routine_id?`, `created_by_app` (bool), `source_item_id` (each event is also a source\_item so it's searchable and extractable).

### 4.5 Notifications and reviews

**push\_subscriptions** — `endpoint`, `p256dh`, `auth`, `device_label`, `last_used_at`, `failed_count` (delete after 3 consecutive 410/404s).

**notifications** — `kind` (`morning_brief | routine_reminder | routine_missed | evening_closeout | review_prompt | queue_digest | follow_up_due | custom`), `scheduled_for`, `sent_at?`, `title`, `body`, `url` (deep link), `payload` (jsonb), `status` (`scheduled | sent | failed | cancelled`). Unique on `(kind, scheduled_for, coalesce(payload->>'routine_id',''))` to prevent duplicates.

**weekly\_reviews** — `week_start` (Monday, unique), `status` (`in_progress | done`), `step_reached` (1–5), `scorecard` (jsonb — see §7.5), `slipped_decisions` (jsonb: `[{task_id, decision: reschedule|drop|delegate, new_due?, note?}]`), `dormant_decisions` (jsonb: `[{project_id|person_id, decision: revive|park|close, next_action?}]`), `week_top3` (uuid\[\]), `coach_text`, `coach_model`, `completed_at?`.

**settings** — key/value jsonb: `timezone`, `morning_brief_time` (default 07:00), `evening_closeout_time` (default 21:00), `weekly_review_day` (default Sunday), `weekly_review_time` (default 17:00), `theme` (`system | light | dark`), `quiet_hours` (`{start: "23:00", end: "06:30"}`), `extraction_interval_minutes` (default 60), `extraction_lookback_days_initial` (default 30), `dormancy_days` (default 14), `queue_digest_enabled`, `pushover_enabled`.

**job\_runs** — `job`, `started_at`, `finished_at`, `status`, `stats` (jsonb), `error?`. Every scheduled job writes a row; the Settings screen shows the last run of each job so sync failures are visible.

---

## 5\. Application structure

```
/app
  /(app)            authenticated shell: bottom tabs (mobile) / sidebar (desktop)
    /today
    /capture        full-screen record/text capture
    /queue          review queue
    /tasks          all tasks, filter by domain/project/status
    /domains/[slug]
    /projects/[id]
    /routines
    /people, /people/[id]
    /notes, /notes/[id]
    /search
    /review         weekly review flow (/review/[weekStart]/[step])
    /settings       accounts, notifications, jobs, routines config
  /api
    /auth/google/*          OAuth start + callback (per-account)
    /auth/granola/*         MCP OAuth (if used)
    /capture                POST audio or text → creates capture, enqueues processing
    /push/subscribe
    /jobs/*                 protected by JOBS_SECRET; called by pg_cron
      sync-google           (every 15 min) Gmail history + Calendar incremental sync
      sync-notion           (every 30 min)
      sync-granola          (every 30 min)
      extract               (hourly) extraction sweep over pending source_items
      process-captures      (every minute, or triggered on POST)
      notifications-tick    (every minute) send due notifications
      routines-nightly      (00:05) write missed logs, compute streaks
      plan-morning          (06:30) compute daily_plans, schedule morning brief
      closeout-evening      (schedule per settings)
      review-prompt         (weekly)
      dormancy-scan         (daily) flag dormant projects/people; schedule follow_up_due pushes for people past their follow_up_every_days cadence
/lib
  /ai       prompts + schemas: fileCapture, extractCommitments, proposeTopItem, weeklyCoach
  /integrations  google/, notion/, granola/
  /domain   pure functions: streaks, completion rates, scorecard, dormancy, top-item heuristic
/supabase/migrations
/docs  SPEC.md, DESIGN_BRIEF.md, DECISIONS.md
```

Route handlers under `/api/jobs/*` must be idempotent (safe to re-run) and finish in under 60s (Vercel Hobby limit); batch and cursor if there is more work than fits, and let the next tick continue.

---

## 6\. Integrations

### 6.1 Google (Gmail \+ Calendar), N accounts

- One Google Cloud project, one OAuth client (web). Scopes: `openid email`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/calendar` (read \+ write). Do **not** request `gmail.modify` or send scopes.  
- Connect flow: Settings → "Connect Google account" → OAuth with `access_type=offline&prompt=consent` → callback stores a `connected_accounts` row keyed on the Google email (re-connecting the same email updates the row). Joshua picks a label, a default domain, which calendars to read, and which single calendar the app may write to.  
- **Known gotcha:** while the OAuth consent screen is in *Testing* status, refresh tokens expire after 7 days. Set the consent screen to *In production* (unverified is fine for personal use with ≤100 users; the "unverified app" interstitial appears once per connect). Log this in DECISIONS.md when done. Gmail scopes are "restricted" — if Google blocks the unverified production app, the fallback is to stay in Testing and add a job that alerts when a token is within 24h of expiry so Joshua can re-consent. Handle `invalid_grant` by setting `status = needs_reauth` and sending a push.  
- **Gmail sync:** initial backfill \= threads from the last `extraction_lookback_days_initial` days (`users.threads.list` with `q=newer_than:30d`), excluding `SPAM`, `TRASH`, `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, and any thread where every message is from a no-reply / newsletter sender (`List-Unsubscribe` header present ⇒ skip). Then incremental via `users.history.list` from the stored `historyId`. One `source_item` per **thread**; when a thread gets a new message, update the item, recompute `content_hash`, reset `extraction_status` to `pending`. Store cleaned text: strip quoted replies and signatures (use `talon`\-style heuristics or a simple "On … wrote:" cut), keep headers (from/to/cc/date/subject) per message.  
- **Calendar sync:** for each `read_calendar_id`, `events.list` with `syncToken` (full sync on first run over −30/+90 days). Write each event to `calendar_events` and to `source_items` (kind `calendar_event`, text \= title \+ description \+ attendees). Attendee emails link to `people` by email match.  
- **Calendar write:** only ever to `writable_calendar_id`. Two uses: (a) "Block time" on a task creates an event, stores `calendar_event_id` on the task, and keeps title/time in sync if the task is rescheduled or done (done → append "✓" to the title, don't delete); (b) routines with `write_to_calendar = true` get a recurring event created once. Deleting a task removes the app-created event. Never modify an event the app didn't create.

### 6.2 Notion (Tarifa), read-only mirror

- Internal integration token (`NOTION_TOKEN`). Joshua shares the relevant Tarifa pages/databases with the integration from Notion's UI. Settings shows what the integration can see.  
- Sync (every 30 min): `search` filtered by `last_edited_time > cursor`, plus a `query` on each configured database. Every page becomes a `source_item` (kind `notion_page`, text \= page title \+ property values \+ block content flattened to markdown; `external_url` \= the Notion URL). Pages in a database that Joshua marks as "task-like" in Settings (mapping: which property is title / status / due / assignee) also produce `tasks` rows with `is_mirror = true`, `origin = notion_mirror`. Mirror tasks show up in Today and in the Tarifa domain with a Notion icon and open the Notion page on tap; they cannot be completed or edited in the app. When the Notion status becomes done/archived, the mirror task's status becomes `done`.  
- No writes to Notion. Ever. (Joshua's standing rule: never revert layouts or views he changed by hand.)

### 6.3 Granola

Facts verified 15 Sept 2026:

- **Granola MCP server** (`https://mcp.granola.ai/mcp`): OAuth 2.0 with Dynamic Client Registration, Streamable HTTP; usable by any MCP client, not just Claude/ChatGPT. Available on all plans. **Basic (free) plan: personal notes from the last 30 days only; transcripts and folders require a paid plan.** Tools: `list_meetings`, `get_meetings`, `get_meeting_transcript` (paid), `list_meeting_folders` (paid), `query_granola_meetings`, `get_account_info`.  
- **Granola Public API** (`https://public-api.granola.ai/v1`): bearer `grn_` API keys, **Business plan or higher**. `GET /notes?created_after=…` (cursor paginated), `GET /notes/{id}?include=transcript`, `GET /notes/{id}/transcript`. Rate limit 5 req/s sustained. Only notes whose AI summary is finished are returned.  
- Neither path has webhooks; both are polled. Neither writes.

**Decision:** implement a `GranolaClient` interface with two adapters — `GranolaMcpAdapter` (default) and `GranolaApiAdapter` (used automatically when `GRANOLA_API_KEY` is set). Both produce the same `source_item` shape (kind `granola_note`, text \= AI summary \+ Joshua's own notes \+ transcript if available, participants from attendees, `occurred_at` \= meeting time, `external_url` \= Granola note link). Sync every 30 minutes using a `created_after` cursor with a 2-day overlap (to catch late-finished summaries), dedupe on external id \+ content hash.

**Open item for Joshua:** confirm which Granola plan you're on. On Basic, you'll get summaries only, and only the last 30 days are visible (the archive keeps everything the app has already fetched, so nothing is lost once fetched). On Business, use the API adapter and get transcripts too.

### 6.4 Adding future sources

Any new source (Almedia's stack, Slack, WhatsApp export, etc.) is a new `provider` value, a new adapter that writes `source_items`, and a `sync-*` job. Extraction, search, people-linking and the queue need no changes. Say this in the code comments so future Claude Code sessions don't build a parallel path.

---

## 7\. AI pipelines

All LLM calls use the Anthropic Messages API with **tool use for structured output** (define a tool whose input schema is the desired JSON; force it with `tool_choice`). Log every call (`ai_calls` table: pipeline, model, input tokens, output tokens, latency, cost estimate) so Settings can show monthly AI spend. Prompts live in `/lib/ai/prompts/*.md` as files, not inline strings, so they can be edited without touching code.

Every prompt receives a **context block** built by `buildContext()`: today's date and timezone, the list of domains, active projects/areas per domain (id \+ name \+ one-line description), the list of known people (id, name, emails, relationship), and the active routines. Keep it under \~4k tokens; truncate people to the 100 most recently contacted.

### 7.1 Capture filing (`fileCapture`)

Input: cleaned transcript or text. Output schema:

```
{ items: [
  { type: "task", title, domain_id, project_id?, person_id?, due_date?, due_time?, priority?, body_md? },
  { type: "note", title, body_md, domain_id?, project_id?, person_id? },
  { type: "routine_log", routine_id, date, status: "done"|"skipped" },
  { type: "person_update", person_id?|new_person:{name,company?,role?}, fact },
  { type: "reminder", title, at }        // becomes a task with due_date/time
], needs_clarification?: string }
```

Rules in the prompt: one capture may produce several items; strip filler; keep Joshua's wording for titles; resolve relative dates ("Friday", "end of month") against today's date in `APP_TIMEZONE`; default domain to `personal` unless a project/person/keyword clearly implies another; if a project or person is named but unknown, create it only when confidence is high, otherwise leave unlinked and mention it in `needs_clarification`. If `needs_clarification` is set, still create the items and show a small banner on the capture result for Joshua to fix.

Transcription: client records with `MediaRecorder` (Safari produces `audio/mp4`; Chrome `audio/webm`), uploads to Supabase Storage `captures/{id}.{ext}`, POSTs the capture. Server sends the file to the transcription API with a prompt listing the domain, project and people names (improves proper-noun accuracy), stores `transcript`, then a cheap LLM pass produces `cleaned_text` (remove fillers, fix punctuation, keep meaning), then `fileCapture`. Show the transcript to Joshua immediately, with the filed items appearing when done. Failures set `status = failed` and keep the audio so it can be retried.

### 7.2 Extraction sweep (`extractCommitments`)

Runs hourly over `source_items` where `extraction_status = pending`, newest first, up to N per run (start with 40). For each item, the prompt gets the context block, the item text, the list of Joshua's **open tasks in the same domain** (title \+ due, to avoid duplicates) and **pending suggestions** (same). Output schema:

```
{ suggestions: [
  { kind: "task"|"deadline_change"|"follow_up"|"person_fact"|"project_update",
    title, detail, evidence (verbatim excerpt ≤ 300 chars),
    proposed: { domain_id, project_id?, person_id?, due_date?, priority?, existing_task_id? },
    confidence: 0..1,
    owner: "me"|"them" }
], nothing_actionable: boolean }
```

Rules: extract (a) commitments Joshua made ("I'll send…", "will get back to you by…"), (b) requests made of Joshua with or without a date, (c) hard deadlines mentioned (consent windows, closing dates, expiry) — as a `task` if new, or a `deadline_change` with `existing_task_id` if an open task's date moved, (d) follow-ups Joshua would reasonably want ("they said they'd send the data room Monday" → `follow_up`, which becomes a task with `owner = them`, due Tuesday), (e) new facts about known people (`person_fact` → appended to `people.notes_md` on accept), (f) status changes to a known project ("the round closed", "First Circle pushed final close to October") → `project_update`, which on accept appends a dated line to the project description and optionally updates `target_date` or `status`. Ignore newsletters, receipts, notifications, and anything already represented by an open task or pending suggestion. Calendar events only yield suggestions when the description contains action language. Only suggestions with `confidence ≥ 0.5` are written; below that, discard. Compute `dedupe_key`; skip if a pending or dismissed suggestion with the same key exists in the last 30 days (dismissed ones stay dismissed).

Queue UI: newest first, grouped by source. Accept creates the task/note/person fact as proposed (editable inline before accepting), links `source_item_id`, and marks the suggestion `accepted`. Dismiss just marks it. Swipe right \= accept, left \= dismiss on mobile. Suggestions older than 14 days auto-`expire`. A `queue_digest` push is sent at most once a day when ≥ 3 suggestions are pending.

### 7.3 Top item proposal (`proposeTopItem`)

Runs at `plan-morning`. **Heuristic first, LLM second.** Heuristic score per open task: overdue (+50, \+5/day up to \+100), due today (+40), due tomorrow (+20), due this week (+10), priority × 8, scheduled today (+30), linked to a person with `follow_up` overdue (+15), project `target_date` within 7 days (+10), belongs to the domain with the least completed tasks in the last 7 days (+5, gentle balance nudge). Take the top 5 by score, then ask the LLM to pick **one** top item and up to two runners-up given today's calendar load (hours of meetings, first meeting time) and write a one-sentence reason. Store in `daily_plans`. Today screen shows the proposal with "Make this my top item" / "Pick another". If Joshua picks another, store `chosen_top_task_id`; the morning brief and close-out use the chosen one.

### 7.4 Coaching read (`weeklyCoach`)

Runs as the last step of the weekly review, on demand. Input: this week's scorecard, the previous 4 weeks' scorecards, the slipped and dormant decisions just made, the chosen top 3 for next week, routine logs by weekday for the last 4 weeks, and the domain breakdown. Output: `{ read: markdown (≤ 220 words), one_change: string, pattern_flags: string[] }`.

Prompt tone rules (verbatim in the prompt file): *Be direct and specific. Lead with the most important number. Name the pattern that is costing him the most, with the data. No praise unless something measurably improved versus the trend, and then one sentence. No exclamation marks, no motivational language, no lists of more than three items. End with exactly one change to make next week and how to tell if it worked.*

### 7.5 Scorecard (pure function, no LLM)

Computed for a Monday–Sunday week, stored in `weekly_reviews.scorecard`:

- Per domain and total: tasks created, completed, dropped, still open, overdue at week end  
- Commitments (tasks with `origin = suggestion` and a due date): delivered on time vs late vs still open  
- Routines: per routine, scheduled vs done vs skipped vs missed; adherence %; current and best streak  
- Queue: suggestions received, accepted, dismissed, still pending at week end; median hours to resolve  
- Captures: count, and how many needed clarification  
- Calendar: meeting hours by domain (from `calendar_events`)  
- People: contacts overdue for follow-up  
- Deltas vs each of the previous 4 weeks and vs the 4-week average

---

## 8\. Notifications

All pushes go through `notifications` rows, sent by `notifications-tick` (every minute), so everything is visible, deduped and cancellable. Each push has a deep link.

| Kind | When | Content |
| :---- | :---- | :---- |
| morning\_brief | `morning_brief_time` daily | Top item, count of tasks due today, first meeting time, routines scheduled today, pending queue count, streaks at risk (missed yesterday) |
| routine\_reminder | each routine's `reminder_time` on its scheduled days | "Gym — tap when done" with a "Done" action button |
| routine\_missed | `reminder_time + grace_minutes` if no log | "Vitamins not logged yet. Skip today or mark done?" with two action buttons |
| evening\_closeout | `evening_closeout_time` | Completed count, top item done or not, routines missed, what rolls to tomorrow, one line if a streak broke |
| review\_prompt | `weekly_review_day/time`; repeat once 3h later if not started | "Weekly review is ready — 12 tasks slipped, 2 projects dormant" |
| queue\_digest | at most once/day, only if ≥ 3 pending | "5 suggestions waiting from 3 emails and 1 meeting" |
| follow\_up\_due | daily scan | "You haven't been in touch with X for 21 days" |
| needs\_reauth / sync\_failed | on error, at most once per account per day | link to Settings |

iOS constraints: push only works once the PWA is installed to the Home Screen and permission is requested from a user tap (Settings → "Enable notifications"). Action buttons on notifications are limited on iOS; render them, but make every push's deep link land on a screen where the action is one tap. Quiet hours (default 23:00–06:30): nothing is sent, and missed nudges that fall inside quiet hours are dropped, not delayed.

---

## 9\. Screens (summary — see DESIGN\_BRIEF.md for full detail)

Today · Capture · Queue · Tasks (by domain/project) · Project · Routines · People · Person · Notes · Note · Search · Weekly Review (5 steps) · Settings (Accounts, Notifications, Routines, Jobs & AI spend, Data export).

Mobile: bottom tab bar (Today, Tasks, **Capture** as a prominent centre button, Routines, More). Desktop: left sidebar; `⌘K` opens the command palette (global search plus quick-add); `⌘J` opens capture (matching Jerad's habit; both configurable).

**Quick-add syntax** (used by the command palette and the quick-add field on Tasks; parsed by `parseQuickAdd()` in `/lib/domain`, no LLM): free text is the title; `#tarifa` / `#personal` sets the domain; `#tarifa/juicy` sets domain and project by slug prefix match; `@bernhard` links a person by name prefix; `!high` / `!med` / `!low` sets priority; a trailing natural date token (`fri`, `tomorrow`, `sep 30`, `next week`, `3pm`) sets due date/time via a small date parser (`chrono-node`); `~sat` sets scheduled date. Unrecognised tokens stay in the title. Show a live preview of the parsed result under the field.

The Today screen is designed for its end state (see DESIGN\_BRIEF §5.1) but is **progressively enabled**: in Phase 1 it shows the task groups and a manual top-item pick only; the schedule strip appears with Phase 3, the queue chip with Phase 3, the proposed top item with Phase 6\. Hide sections whose data source isn't connected rather than showing empty placeholders.

**Theme:** system-following light/dark from Phase 0 (`settings.theme = system | light | dark`), tokens per DESIGN\_BRIEF §3.

Data export (Settings): one button that produces a zip of JSON per table plus markdown for notes, and a "storage used" line (audio bucket size from Supabase Storage plus `pg_database_size()`). Build it in Phase 1; it's the antidote to lock-in and it makes the "archive everything" promise real.

---

## 10\. Build phases

Each phase lists what ships, the data model it needs, and the **live-in-it test** — the condition under which Joshua uses the app daily before the next phase starts. Do not start a phase until the previous one's test is met. Estimated effort is for Claude Code driven by Joshua, in focused sessions.

### Phase 0 — Foundation (1–2 sessions)

Ships: repo, Next.js \+ Tailwind \+ shadcn scaffold, Supabase project and migrations for **all** tables in §4 (create the full schema now so later phases don't migrate data), single-user auth, PWA manifest \+ service worker \+ install prompt, app shell with navigation, domains seeded (Personal, Almedia \[placeholder\], Tarifa, Misc), Settings skeleton, `/api/jobs` scaffold with secret check and `job_runs` logging, pg\_cron schedules registered (jobs may be no-ops), push subscription flow with a "send test notification" button, `.env.example`, `docs/`.

Live-in-it test: installed on iPhone home screen and Mac, receives a test push on the phone.

### Phase 1 — Tasks, capture, notes, export (2–3 sessions)

Ships: projects/areas CRUD; tasks CRUD with due/scheduled/priority/recurrence/owner; Today screen (tasks grouped Overdue / Due today / Scheduled today / Rolling over — i.e. open tasks that were due or scheduled yesterday and got neither done nor rescheduled — plus a manual "top item" pick; proposal comes in Phase 6; undated tasks live on the Tasks screen, not Today); Tasks screen with domain and project filters and quick-add; Domain screen; Project screen; command palette (⌘K) with quick-add; **voice capture** (record → upload → transcribe → clean → file) and text capture, with the result view; notes CRUD with markdown; keyword search over tasks and notes; data export; basic `last_activity_at` bumping.

Live-in-it test: Joshua has moved every personal task into the app, uses voice capture from his phone daily, and hasn't opened another task tool for a week.

### Phase 2 — Routines and notifications (1–2 sessions)

Ships: routines CRUD; daily check-off UI with streaks and 4-week completion rate; `routines-nightly`; morning brief, routine reminders, missed nudges, evening close-out; quiet hours; notification history in Settings; optional Pushover fallback.

Live-in-it test: gym, vitamins and morning routine tracked for two weeks with pushes arriving reliably on the phone.

### Phase 3 — Google accounts, archive, extraction queue (3–4 sessions)

Ships: multi-account Google OAuth; Gmail backfill \+ incremental sync into `source_items`; Calendar read into `calendar_events` \+ `source_items` and shown on Today; calendar **write** ("Block time" on a task; routine → recurring event); extraction sweep; Queue screen with accept/dismiss and inline edit; queue digest push; sync status and errors in Settings; `ai_calls` cost tracking.

Live-in-it test: both current Google accounts connected (personal, Tarifa), queue is being cleared each morning, at least one real commitment that would otherwise have been forgotten was caught.

### Phase 4 — Notion mirror and Granola ingestion (2 sessions)

Ships: Notion integration setup UI \+ database-to-task mapping; mirror tasks in Today/Tarifa with links out; Granola adapter (MCP by default, API if key present) with sync; both feed `source_items` and the extraction sweep; Granola notes readable inside the app (Source item view).

Live-in-it test: Tarifa's Notion items appear alongside personal tasks; a Granola meeting produced a correct suggestion within an hour of the summary finishing.

### Phase 5 — People and full search (2 sessions)

Ships: people CRUD; automatic person creation/linking from email participants and calendar attendees (with a "merge" tool for duplicates); Person screen (owed/owing tasks, notes, timeline of source items, last contact, follow-up cadence); follow\_up\_due push; `person_fact` suggestions; search extended to people and the full `source_items` archive with filters (domain, kind, date, person).

Live-in-it test: "What do I owe Bernhard?" is answerable from the Person screen in one tap; search finds an email from a month ago by keyword.

### Phase 6 — Daily plan proposal and weekly review coach (2–3 sessions)

Ships: `plan-morning` with heuristic \+ LLM top-item proposal on Today and in the morning brief; dormancy scan; weekly review flow (Scorecard → Slipped → Dormant → Ahead → Coach) with forced decisions per item; `weeklyCoach`; review history with trend charts (adherence, completion, on-time rate over weeks); review prompt push.

Live-in-it test: two consecutive weekly reviews completed; the coach read named something Joshua agreed was true and changed.

### Phase 7+ (not yet specified — do not build)

Almedia sources once known · semantic search \+ chat over the archive (pgvector) · Apple Shortcuts endpoint for capture from Siri/Watch · auto-accept for high-confidence suggestions if the queue proves unnecessary · Tarifa two-way sync if ever wanted.

---

## 11\. Quality bar

- TypeScript strict; Zod schemas for every API route and LLM output; `pnpm typecheck && pnpm lint && pnpm test` green before each phase is called done.  
- Unit tests for `/lib/domain` (streaks, completion rates, scorecard, top-item heuristic, dedupe keys, recurrence spawning) and for email cleaning. Integration adapters get contract tests against recorded fixtures (store sanitised API payloads under `/fixtures`).  
- Mobile first: every screen usable one-handed at 390px width; tap targets ≥ 44px; works offline for reading Today and queuing a capture (service worker caches shell \+ last Today payload; captures made offline upload when back online).  
- Performance: Today loads in \< 1s on a phone from a warm cache. Paginate the archive and queue.  
- Security: RLS on every table; service role only in jobs; tokens encrypted; `/api/jobs/*` rejects without `JOBS_SECRET`; no third-party analytics; CSP headers.  
- Observability: `job_runs` and `ai_calls` visible in Settings; a `sync_failed` push when a job fails twice in a row.

---

## 12\. Decisions log (from the spec conversation, 15 Sept 2026\)

- App is the single source of truth for Joshua-only tasks; shared work (Tarifa/Bernhard) is mirrored read-only from Notion. Confirmed.  
- Domains: Personal, Almedia (placeholder until its stack is known), Tarifa, Misc. Middle layer of projects/areas: yes.  
- "Smart" \= AI reads email, meeting notes, Notion and extracts commitments/deadlines into a **review queue** (accept/dismiss). Auto-accept is a possible later change, not v1.  
- Google accounts: unlimited; personal and Tarifa connected in v1. Calendar: read **and** write (to one designated calendar per account).  
- Granola: won't cover all meetings; ingest what it has; archive locally.  
- Voice: real recording on the phone from day one, not just dictation into a text box.  
- Routines: weekly review, morning routine, gym, vitamins and similar; gamified via streaks, missed nudges, rolling rates; weekly review is a substantive coaching session with numbers and honest feedback, not a checklist.  
- v1 includes notes and a people tracker; excludes journal/quotes and content pipeline.  
- Search: keyword in v1; semantic later.  
- Day planning: list plus an auto-proposed top item ("a bit of both").  
- Build: phased, Joshua driving Claude Code; design via Claude Design from DESIGN\_BRIEF.md.

## 13\. Open questions for Joshua (answer before the relevant phase)

1. **Granola plan** (Basic vs Business) — decides transcripts and which adapter. Needed by Phase 4\.  
2. **Which Notion databases/pages** in the Tarifa workspace should be mirrored, and which property means "done". Needed by Phase 4\.  
3. **Domain name** for the app (e.g. `os.yourdomain.com`) — needed for Google OAuth redirect URIs in Phase 3, and iOS push wants a stable origin from Phase 0\. Pick before Phase 0\.  
4. **Morning brief / close-out / review times** — defaults 07:00, 21:00, Sunday 17:00; change in Settings any time.  
5. **Almedia**: revisit after the first month. Even if nothing connects, Granola may capture Almedia meetings — decide then whether those should be tagged Almedia automatically (by attendee email domain) or left for manual filing.

