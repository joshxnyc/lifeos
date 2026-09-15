# CONTRACTS.md — internal build contracts

Read this before touching code. It defines file ownership between build
workstreams and the shared APIs everything codes against. SPEC.md governs
behaviour; DESIGN_BRIEF.md governs look and feel; this file governs structure.

## Shared kernel (already built — use, don't rewrite)

| Module | Exports | Notes |
| :--- | :--- | :--- |
| `lib/env.ts` | `serverEnv()`, `publicEnv()` | zod-validated, lazy |
| `lib/utils.ts` | `cn()`, `sha256Hex()` | |
| `lib/types.ts` | every DB row type + `Scorecard`, `Settings`, `DEFAULT_SETTINGS` | matches `/supabase/migrations` exactly |
| `lib/supabase/client.ts` | `createClient()` (browser) | |
| `lib/supabase/server.ts` | `createClient()` (RLS, per-request), `currentUserId()` | |
| `lib/supabase/service.ts` | `createServiceClient()`, `singleUserId()` | jobs/OAuth only |
| `lib/crypto.ts` | `encryptToken()`, `decryptToken()` | AES-256-GCM |
| `lib/settings.ts` | `getSettings()`, `setSetting()` | |
| `lib/jobs.ts` | `jobRoute(name, handler)` | wraps every `/api/jobs/*` route; secret check + job_runs + double-failure push |
| `lib/notify.ts` | `enqueueNotification()`, `isInQuietHours()` | never call `sendPush` directly from features — enqueue, tick sends |
| `lib/push.ts` | `sendPushToAllDevices()` | used by notifications-tick and the test button only |
| `lib/time.ts` | `localDate()`, `localTime()`, `localDayOfWeek()`, `mondayOf()`, `addDays()`, `isDueNow()` | |
| `lib/ai/client.ts` | `callStructured<T>()`, `callText()`, `loadPrompt()`, `MODEL_MAIN`, `MODEL_CHEAP` | logs ai_calls; prompts in `lib/ai/prompts/*.md` |
| `lib/ai/context.ts` | `buildContext()` | SPEC §7 context block |
| `components/ui/*` | `Button`, `EmptyState`, `PageHeader`, `DomainChip`, `PersonAvatar`, `DOMAIN_COLOR_CLASS`, `DOMAIN_EDGE_CLASS` | |
| `components/shell/*` | app shell — owned by the orchestrator | ask before editing |

## Ground rules for every workstream

1. **Never run `pnpm install` or edit `package.json`** — all deps are installed. If something is genuinely missing, note it in your final report.
2. Write only inside the files/dirs you own (table below). Shared files (`app/(app)/layout.tsx`, `app/globals.css`, `lib/*` kernel, `package.json`) are orchestrator-owned.
3. Don't run `pnpm typecheck`/`build` — other workstreams are writing concurrently and you'll see their half-finished files. Get your own code right; integration runs afterwards.
4. Server mutations are **server actions** (`"use server"`) colocated in `actions.ts` files, validated with zod; jobs are route handlers via `jobRoute()`. Client components only where interaction demands it.
5. Every job handler: idempotent, < 60s, batch with cursors, return a stats object.
6. Mobile first at 390px, tap targets ≥ 44px, tokens from globals.css only (`text-ink`, `bg-paper`, `border-line`, `text-accent`, `bg-accent-soft`, `text-ok/warn/danger`, `font-display`, `.section-label`, `.tabular`, `rounded-card`). Copy rules: no exclamation marks, verbs on buttons, numbers over adjectives.
7. `tasks.is_mirror = true` rows are read-only in every UI you build: no checkbox, Notion glyph, link out.
8. Bump `projects.last_activity_at` on any task/note/capture write that touches a project.
9. Dates: `due_date`/`scheduled_date` are `date` strings in the user's timezone; comparisons via `lib/time.ts` helpers, never `new Date().toISOString().slice(0,10)` (UTC bug).

## Ownership map

| Workstream | Owns |
| :--- | :--- |
| **D — domain logic** | `lib/domain/**`, `lib/email/**`, `tests/**` (vitest, incl. `vitest.config.ts`) |
| **A1 — tasks & today** | `app/(app)/today/**`, `app/(app)/tasks/**`, `app/(app)/domains/**`, `app/(app)/projects/**`, `components/tasks/**`, `components/today/**`; `components/shell/command-palette.tsx` (may replace) |
| **A2 — capture/notes/search/export** | `app/(app)/capture/**`, `app/(app)/notes/**`, `app/(app)/search/**`, `app/api/capture/**`, `app/api/export/**`, `app/api/jobs/process-captures/**`, `lib/ai/prompts/file-capture.md`, `lib/ai/pipelines/file-capture.ts`, `lib/transcribe.ts`, `components/capture/**`, `components/notes/**`, `components/search/**` |
| **A3 — routines & notifications** | `app/(app)/routines/**`, `app/api/jobs/{notifications-tick,routines-nightly,closeout-evening,review-prompt,schedule-day}/**`, `components/routines/**`, `components/push/**` (subscribe UI used by Settings), `lib/routines.ts` |
| **A4 — integrations** | `lib/integrations/**`, `app/api/auth/google/**`, `app/api/auth/granola/**`, `app/api/jobs/{sync-google,sync-notion,sync-granola}/**`, `app/(app)/settings/**` (whole Settings area incl. accounts, notifications config UI, jobs & AI spend, data section wiring), `app/(app)/source/[id]/**` (archive item view), `components/settings/**` |
| **A5 — AI queue/people/review** | `app/(app)/queue/**`, `app/(app)/people/**`, `app/(app)/review/**`, `app/api/jobs/{extract,plan-morning,dormancy-scan}/**`, `lib/ai/prompts/{extract-commitments,propose-top-item,weekly-coach,person-matching}.md`, `lib/ai/pipelines/{extract,top-item,coach}.ts`, `lib/people.ts`, `components/queue/**`, `components/people/**`, `components/review/**` |

Cross-stream needs: call another stream's *server action or lib function by its
contracted name below*; if it doesn't exist yet, code against the signature and
note it — integration wires it up.

## Contracted shared signatures (implement in the owning stream)

### D (lib/domain) — pure functions, no I/O, all unit-tested
```ts
// lib/domain/quick-add.ts
parseQuickAdd(input: string, ctx: {
  domains: Pick<Domain, "id"|"slug"|"name">[];
  projects: Pick<Project, "id"|"name"|"domain_id">[];
  people: Pick<Person, "id"|"name">[];
  today: string; // YYYY-MM-DD local
}): { title: string; domain_id?: string; project_id?: string; person_id?: string;
      priority?: 0|1|2|3; due_date?: string; due_time?: string; scheduled_date?: string;
      tokens: { raw: string; kind: "domain"|"project"|"person"|"priority"|"due"|"scheduled" }[] }

// lib/domain/streaks.ts
computeStreaks(logs: Pick<RoutineLog,"date"|"status">[], scheduleDays: number[], today: string):
  { current: number; best: number }
completionRate(logs: Pick<RoutineLog,"date"|"status">[], scheduleDays: number[], today: string, days: number): number // 0..1, skipped excluded from denominator

// lib/domain/recurrence.ts
nextOccurrence(rrule: string, after: string): string | null // next date YYYY-MM-DD

// lib/domain/dedupe.ts
suggestionDedupeKey(title: string, due: string | null | undefined, personId: string | null | undefined): string // sync, normalized hash

// lib/domain/top-item.ts  (SPEC §7.3 heuristic)
scoreTask(task: Task, ctx: { today: string; weekEnd: string; domainCompletions7d: Record<string, number>;
  overdueFollowUpPersonIds: Set<string>; projectTargetDates: Record<string, string | null> }): number
rankTasks(tasks: Task[], ctx: ...): Task[] // sorted desc, top 5 consumers slice

// lib/domain/scorecard.ts
computeScorecard(input: {...raw rows...}): Scorecard // see lib/types.ts Scorecard; document the input shape in the file

// lib/domain/dormancy.ts
isDormant(lastActivityAt: string, dormancyDays: number, now: Date): boolean

// lib/email/clean.ts
cleanEmailText(rawBodies: { from: string; to: string; cc?: string; date: string; subject: string; textBody: string }[]): string
// strips quoted replies ("On … wrote:"), signatures; keeps per-message headers
isNewsletterish(headers: Record<string, string>): boolean // List-Unsubscribe etc.
```

### A2
```ts
// lib/ai/pipelines/file-capture.ts
processCapture(supabase: SupabaseClient, userId: string, captureId: string): Promise<void>
// transcribe (if audio) → clean → fileCapture → create rows → captures.result/status
```

### A3
```ts
// lib/routines.ts (server)
logRoutine(routineId: string, date: string, status: "done"|"skipped"): Promise<void> // server action; upserts
```

### A5
```ts
// lib/people.ts (server-side, service or RLS client both fine via arg)
linkParticipantsToPeople(supabase, userId, sourceItemId, participants: {name?: string; email?: string; role: string}[]): Promise<void>
// email-matches to people, inserts people_source_items, bumps last_contact_at
acceptSuggestion(id: string, edited?: Partial<SuggestionProposed>): Promise<void> // server action
dismissSuggestion(id: string): Promise<void>
```

### A4
```ts
// lib/integrations/google/client.ts
getGoogleClientForAccount(supabase, account: ConnectedAccount): Promise<OAuth2Client> // refresh + invalid_grant → needs_reauth + push
// lib/integrations/source-items.ts
upsertSourceItem(supabase, userId, item: {...}): Promise<{ id: string; changed: boolean }>
// content_hash compare; resets extraction_status to pending when changed; calls linkParticipantsToPeople
```

## Notifications matrix (who enqueues what)

| kind | enqueued by | job |
| :--- | :--- | :--- |
| morning_brief | plan-morning (A5) | schedules at settings time |
| routine_reminder / routine_missed | schedule-day (A3) — enqueues today's reminders each morning; missed nudges scheduled at reminder+grace, cancelled on log | |
| evening_closeout | closeout-evening (A3) | |
| review_prompt | review-prompt (A3) — repeat once 3h later if review not started | |
| queue_digest | extract (A5) — ≥3 pending, ≤1/day | |
| follow_up_due | dormancy-scan (A5) | |
| needs_reauth / sync_failed | integrations (A4) / jobRoute wrapper | |

`notifications-tick` (A3) is the only sender: every minute, pick `scheduled`
rows due, drop those inside quiet hours (missed nudges are dropped, not
delayed — SPEC §8), send via `sendPushToAllDevices`, mark sent/failed.

## Route map (final)

Mobile tabs: Today · Tasks · Capture · Routines · More(Queue, People, Notes, Search, Review, Settings).
Screens: `/today /capture /queue /tasks /domains/[slug] /projects/[id] /routines /routines/[id] /people /people/[id] /notes /notes/[id] /search /review /review/[weekStart]/[step] /settings /source/[id]`.
Jobs: `/api/jobs/{sync-google,sync-notion,sync-granola,extract,process-captures,notifications-tick,routines-nightly,plan-morning,closeout-evening,review-prompt,dormancy-scan,schedule-day}`.
