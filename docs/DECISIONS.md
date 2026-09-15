# DECISIONS.md — log of decisions the spec left open

Per SPEC.md: every decision made during the build that the spec did not settle gets a dated entry here, with the reasoning. Decisions already made in the planning conversation live in SPEC.md §12 and CLAUDE.md §3 and are not repeated.

Format: `date — decision — reasoning — decided by (Joshua / Claude Code, confirmed by Joshua / Claude Code, spec-consistent default)`.

---

- **2026-09-15 — Repository bootstrapped with docs only; no application code yet.** The spec's own placement rules applied: `SPEC.md` and `DESIGN_BRIEF.md` copied to `/docs`, `CONTEXT.md` became `CLAUDE.md` at the repo root so every future Claude Code session loads it automatically. `docs/SETUP.md` added as the pre-Phase-0 checklist of external accounts, keys and decisions (the spec lists the env vars but not the acquisition steps). Decided by: Claude Code, spec-consistent default.

- **2026-09-15 — One-shot build of all six phases, authorized by Joshua.** Joshua explicitly instructed: "build this entirely in one shot, phased", overriding SPEC's stop-between-phases rule for the initial build. The phase structure survives in commit history and in the progressive enablement of the Today screen; the live-in-it tests still apply after deploy, phase by phase, before trusting each layer. Decided by: Joshua.
- **2026-09-15 — LLM model ids.** SPEC named `claude-sonnet-4-5` "or current Sonnet"; current Sonnet is `claude-sonnet-5` ($2/$10 per MTok — cheaper than Sonnet 4.5 was), used for extraction/filing/coach; `claude-haiku-4-5` for the cheap transcript-cleanup pass. Structured output via forced tool_choice + strict schemas, thinking disabled on pipeline calls for determinism and cost. Decided by: Claude Code, spec-consistent default.
- **2026-09-15 — UI kit hand-rolled on Radix primitives + cmdk instead of the shadcn/ui CLI.** Same underlying stack shadcn generates, but the components are written directly against the DESIGN_BRIEF tokens (paper/ink/accent), which shadcn's defaults would have fought. No behavioural difference. Decided by: Claude Code.
- **2026-09-15 — pg_cron reads the app URL and jobs secret from a `private.app_config` table** (populated once after deploy) rather than hardcoding them in a migration. Time-of-day jobs (morning plan, close-out, review prompt, nightly missed-log) run every 15 minutes and no-op unless the configured local time just passed — this makes user-changeable times in Settings work without re-registering cron. Decided by: Claude Code.
- **2026-09-15 — `array_to_string` wrapped in an IMMUTABLE `public.immutable_join()`** for the people search vector (Postgres requires immutable expressions in generated columns). Found by applying the migration to a real Postgres 16. Decided by: Claude Code.
- **2026-09-15 — notifications.kind check constraint** also allows `needs_reauth`, `sync_failed`, `test` (SPEC §8 table lists needs_reauth/sync_failed as pushes but §4.5 omitted them from the enum). Decided by: Claude Code, spec-consistent.

- **2026-09-15 — Single LLM key via OpenRouter, replacing separate Anthropic + OpenAI keys.** Joshua's call. Models: `anthropic/claude-sonnet-5` (extraction/filing/coach), `anthropic/claude-haiku-4.5` (transcript cleanup), `google/gemini-3.8-flash` (voice transcription — OpenRouter has no Whisper endpoint, so an audio-capable chat model does transcription). `ai_calls.cost_estimate_usd` now records OpenRouter's actual charged cost (usage accounting) instead of an estimate. A direct-OpenAI Whisper fallback stays in the code, dormant unless `OPENAI_API_KEY` is set, in case Safari `audio/mp4` / Chrome `audio/webm` clips transcribe poorly through OpenRouter. Decided by: Joshua (single key), Claude Code (model mapping + fallback).

<!-- Pending entries the spec explicitly expects:
- Google OAuth consent screen set to "In production" (or the Testing + token-expiry-alert fallback) — log when done, per SPEC §6.1.
- Granola plan confirmed (Basic vs Business) → which adapter is active — per SPEC §6.3.
- Which Notion databases/pages are mirrored and the property mapping — per SPEC §13.2.
- The app's domain name — per SPEC §13.3.
-->
