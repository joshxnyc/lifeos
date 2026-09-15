# LifeOS

A single-user personal operating system: an installable PWA that is the single source of truth for every task that is Joshua's alone, across four domains (Personal, Almedia, Tarifa, Misc). It ingests email, calendars, Granola meeting notes and the Tarifa Notion into its own archive, has AI extract commitments into a review queue, tracks routines with streaks and push notifications, and runs a guided weekly review that ends in an honest, numbers-based coaching read.

## Documents

| File | What it is |
| :--- | :--- |
| [`CLAUDE.md`](CLAUDE.md) | Project context: who the user is, every planning decision and its reasoning, working rules. Loaded by Claude Code automatically. |
| [`docs/SPEC.md`](docs/SPEC.md) | The build spec — source of truth for what to build and in what order (6 phases). |
| [`docs/DESIGN_BRIEF.md`](docs/DESIGN_BRIEF.md) | Screens, visual tokens, components, and the paste-in prompt for Claude Design. |
| [`docs/SETUP.md`](docs/SETUP.md) | Pre-build checklist: accounts, keys and decisions each phase depends on. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Running log of decisions the spec left open. |

## Status

Pre-Phase 0. Design in progress in Claude Design; build prerequisites being collected per `docs/SETUP.md`.

## Stack (once built)

Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui, PWA via `@serwist/next` · Supabase (Postgres, Auth, Storage, pg_cron) · Vercel · Anthropic API (extraction/filing/coach) · OpenAI transcription · Web Push (VAPID).
