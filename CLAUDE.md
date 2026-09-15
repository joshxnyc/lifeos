# LifeOS — Project Context

Paste this into `CLAUDE.md` (Claude Code) and into the project context for Claude Design. It records who the user is, what is being built and why, every decision made in the planning conversation and the reasoning behind it, and how Joshua wants to work. The two companion documents are `SPEC.md` (build spec, phases, data model, integrations) and `DESIGN_BRIEF.md` (screens, tokens, paste-in design prompt). This file is the "why"; those are the "what".

---

## 1\. Who the user is

Joshua Sta Ana. Based in New York. Growth operator and repeat founder (founded an edtech bootcamp and a career-tech startup; previously growth at a consumer app studio and talent management at TikTok). Starting a new job as Venture Manager at Almedia (Freecash) in October 2026\. Separately, he does advisory and administrative work for Tarifa Holding, the family office of Bernhard Niesner: reviewing dealflow, writing investment memos, handling LP consents and portfolio admin. That work is shared with Bernhard through Notion and a separate Tarifa Google account.

He is not a professional engineer but builds real products by driving Claude Code, and he wants to understand what is being built rather than have it happen to him. He has abandoned many productivity tools because they turned into a chore or became one more place to check.

## 2\. What is being built, in plain words

A personal "life operating system": a progressive web app installed on his iPhone and used in a browser on his Mac. It is the single place for every task that is his alone, across four life domains — **Personal, Almedia, Tarifa, Misc** — with a middle layer of **projects and areas** under each domain. It connects his email accounts, calendars, Granola meeting notes and the Tarifa Notion, has AI read them to extract commitments and deadlines into a **review queue** he accepts or dismisses, tracks **routines** (weekly review, morning routine, gym, vitamins, and similar) with streaks and push notifications, and runs a **guided weekly review** that ends with an honest, numbers-based coaching read. It also holds notes and a people/relationship tracker, with keyword search across everything.

The problem it solves is slippage: things promised in an email or a meeting that get forgotten, routines that fade without nudges, projects that go dormant unnoticed.

The reference model is Jerad Hill's app (built with Claude Code: Node, Supabase, PWA, Claude API for filing captures, Pushover for push, \~$8.50/month). Joshua's version is more integration-heavy (email, Notion, Granola ingestion, AI extraction) and adds the coaching layer. Jerad's key lesson, which Joshua accepted as a design principle: the hard part isn't building, it's staying in one system.

## 3\. Decisions made in the planning conversation, with the reasoning

**System of record.** The app is the single source of truth for Joshua-only tasks. He will stop using Notion, Apple Reminders and similar for personal tasks. Anything that involves other people or must be visible to them stays in whatever that team uses — today that means Tarifa work in Notion for Bernhard. *Why:* the failure mode of a "smart window over other tools" is that it becomes a fifth place to check; the Jerad model works because tasks live nowhere else.

**Tarifa Notion is mirrored read-only.** Tarifa tasks and notes appear in the app alongside personal tasks, with a link out to Notion, and cannot be edited or completed in the app. No two-way sync. *Why:* read-only is dramatically simpler and rarely breaks; two-way sync is where these systems get flaky. Standing rule from Joshua's other work: never revert Notion layouts or views he changed by hand — so the app never writes to Notion at all. He uses Notion for Tarifa as notes on what to do and some of the work itself, not as a real task tracker.

**"Smart" is defined as extraction.** AI passes over new emails, meeting transcripts and Notion pages, extracts commitments Joshua made, requests made of him, hard deadlines, follow-ups others owe him, and facts about people, and proposes them. This is the feature that actually prevents slippage, so it is the core; the daily briefing and chat-with-my-data are secondary.

**Review queue, not auto-create.** Extracted items go into a queue with accept/dismiss. Joshua chose this for now and may remove the queue later if it proves unnecessary. *Why:* every false positive that auto-creates a task is a task he has to delete, and after two weeks of that he stops trusting the list — the exact slippage the app exists to kill. Captures Joshua dictates himself *do* auto-file, since he authored them.

**Accounts.** Personal Gmail and the Tarifa Google account are connected in v1 (he has connected Claude to the Tarifa account before, so access is known to work). Almedia's stack is unknown; if it can't be connected, that's fine — the Almedia domain exists for manual tasks. **The number of Google accounts must not be limited**; adding one later is a button, not a code change.

**Calendar: read and write.** Read to show the day and judge load; write so an accepted deadline can become a time block and routines can appear as events. Writes only go to one designated calendar per account.

**Granola.** Won't cover all his meetings for now; ingest what it has. **Everything fetched from Granola (and every other source) is archived in the app's own database** so losing access to Granola, or to any account, loses nothing historical. Verified facts: Granola's MCP server works for custom apps on all plans, but the free plan exposes only the last 30 days and no transcripts; the REST API requires a Business plan. The spec supports both behind one adapter. Joshua still needs to confirm his plan.

**Voice capture.** Real audio recording from a tap on the phone, from day one — Joshua explicitly did not want "just a text box with dictation". No background or Apple Watch capture. Recording works in an installed PWA on iOS; the audio goes to a transcription API, then Claude cleans and files it.

**Routines and gamification.** Routines include the weekly review, a morning routine, gym, vitamins and similar. Gamification means missed-routine nudges, streaks, rolling completion rates, and a **substantive guided weekly review** — Joshua's words: "real coaching sessions with numbers and honest feedback rather than a checklist". No points, levels or confetti. The weekly review has five steps: Scorecard (numbers vs the previous four weeks) → Slipped (every overdue task gets a forced decision: reschedule, drop, delegate) → Dormant (projects and people with no activity in 14 days: revive with a next action, park, or close) → Ahead (next week's load and a top 3\) → Coach (a short written read from Claude that names the pattern costing him most, with the data, and one change for next week; direct, no cheerleading).

**Day planning.** A list, plus an automatically proposed "top item" for the day — "a bit of both". Heuristic scoring first, then Claude picks one from the top candidates given calendar load and writes a one-line reason. Joshua can override.

**Scope of v1.** Includes notes and a people/relationship tracker (a Person page answers "what do I owe this person and what do they owe me", with linked notes, emails and meetings, and last-contact nudges). Includes a search bar across tasks, notes, people and the archive (keyword in v1; semantic/chat later). Excludes journal, quotes, content pipeline, Almedia integrations, two-way Notion sync, native apps.

**Stack.** Next.js PWA on Vercel, Supabase (Postgres, auth, storage, pg\_cron for scheduled jobs), Anthropic API for extraction/filing/coach, OpenAI transcription, native Web Push (iOS supports it for home-screen web apps; Pushover kept as optional fallback), Postgres full-text search. Expected cost well under $15/month. *Why:* it's essentially Jerad's stack with modern defaults, and it's what Claude Code is most fluent in.

**Build approach.** Phased, in this order, each phase ending in a state Joshua can live in before the next starts: (0) foundation and PWA/push, (1) tasks, capture, notes, export, (2) routines and notifications, (3) Google accounts, archive, extraction queue, (4) Notion mirror and Granola, (5) people and full search, (6) top-item proposal and weekly review coach. Joshua drives Claude Code with `SPEC.md`; screens come from Claude Design using `DESIGN_BRIEF.md`.

**Design direction.** Warm editorial planner — light warm paper background, terracotta accent used sparingly, Fraunces headings, Inter body — rather than a dark developer dashboard, because it's the first thing he looks at every morning and should feel like a well-made planner. Dark mode exists for use in bed. Domain colors appear only as edges and dots, never full backgrounds. Copy is direct, no exclamation marks, numbers over adjectives.

## 4\. How Joshua wants to work with Claude on this

- Ask clarifying questions when something is genuinely ambiguous; don't guess on decisions that are his to make. But don't re-ask things settled above.  
- Push back when a choice looks wrong, with the reasoning, then respect his call.  
- Build phase by phase; stop at the end of each phase so he can use it for a few days. Do not build ahead of the current phase.  
- Keep him understanding what's being built: explain the shape of a change before making it when it touches the data model or an integration.  
- Log any decision the spec left open in `docs/DECISIONS.md`.  
- Never write to Notion. Never modify calendar events the app didn't create. Never request Gmail scopes beyond read-only.

## 5\. Open questions Joshua still has to answer

1. Granola plan (Basic vs Business) — needed before Phase 4\.  
2. Which Tarifa Notion databases/pages to mirror, and which property means "done" — needed before Phase 4\.  
3. A domain name for the app — needed before Phase 0 finishes (Google OAuth redirect URIs and iOS push both want a stable origin).  
4. Morning brief / evening close-out / weekly review times — defaults 07:00, 21:00, Sunday 17:00; adjustable in Settings.  
5. Almedia — revisit after his first month. Even without integrations, Granola may capture Almedia meetings; decide then whether attendees' email domain should auto-tag them.

## 6\. Known gotchas already identified

- Google OAuth in "Testing" status expires refresh tokens every 7 days; publish the consent screen as unverified for personal use, and handle `invalid_grant` by flagging the account for re-auth with a push.  
- Vercel Hobby crons only run daily; scheduled jobs therefore run from Supabase `pg_cron` calling protected API routes.  
- iOS PWAs cannot be share-sheet targets and only receive push once installed to the Home Screen with permission granted from a user tap.  
- Safari records audio as `audio/mp4`; Chrome as `audio/webm`. Transcription must accept both.  
- Granola has no webhooks; everything is polled with a cursor and a two-day overlap to catch late-finished summaries.

