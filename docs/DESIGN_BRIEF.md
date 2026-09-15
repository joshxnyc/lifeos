# LifeOS — Design Brief for Claude Design

Companion to `SPEC.md` (the build spec for Claude Code). This document describes what the screens are, how they're organised, how they should feel, and gives a ready-to-paste prompt for Claude Design at the end. Where this document and the spec disagree on behaviour, the spec wins; where they disagree on look and feel, this document wins.

---

## 1\. What this is, in one paragraph

A single-user personal operating system, installed as a web app on an iPhone and used in a browser on a Mac. It holds every task Joshua owns across four life domains (Personal, Almedia, Tarifa, Misc), tracks daily routines with streaks, ingests his email, calendar, meeting notes and Notion so AI can propose commitments it spots, and runs a guided weekly review that ends in a short, honest coaching read. It is opened first thing in the morning on the phone, glanced at between meetings, and used properly on the desktop during work.

## 2\. The person and the moments

Joshua: growth operator and repeat founder, starting a new venture-manager job while advising a family office on the side. Comfortable with dense information, impatient with clutter, has abandoned many productivity tools because they became a chore. He is the only user.

The five moments the design must nail, in priority order:

1. **07:00, phone, in bed or making coffee.** Morning brief push → Today screen. Needs to answer "what's the one thing, what's due, what's my first meeting, what's waiting in the queue" in a five-second glance.  
2. **Walking between places, phone, one thumb.** Capture. Big record button, no menus, sees the transcript appear, done. Occasionally clears the queue with swipes.  
3. **Desk, Mac, during work.** Task list by domain, project pages, notes, search, ⌘J to capture, ⌘K to search. Dense and keyboard-friendly.  
4. **Evening, phone.** Close-out push → tick off routines, see what rolls over. Thirty seconds.  
5. **Sunday afternoon, Mac (sometimes phone).** Weekly review. Fifteen minutes, five steps, feels like a session with a demanding coach, not a form.

## 3\. Visual direction: warm editorial planner

The reference is a well-made paper planner and a good magazine's front section, not a monitoring dashboard. Light, warm, typographic. Confidence comes from hierarchy and whitespace, not from borders and cards everywhere. Color is used sparingly and almost only to mean something (domain, status, urgency).

**Avoid:** dark-by-default developer aesthetic, neon accents, glassmorphism, gradients, drop shadows heavier than a whisper, badge/confetti gamification, emoji as UI (Joshua may add emoji to routine names himself; the chrome shouldn't).

### Tokens

Palette (light, default):

| Token | Value | Use |
| :---- | :---- | :---- |
| `paper` | `#F7F3EC` | app background |
| `paper-2` | `#EFE9DF` | grouped sections, sidebar, inputs |
| `ink` | `#1E1A16` | primary text |
| `ink-2` | `#5C554C` | secondary text |
| `ink-3` | `#9A928A` | tertiary text, placeholders, disabled |
| `line` | `#E2DBCF` | hairlines and dividers |
| `accent` | `#A84B28` | primary actions, the top item marker, links |
| `accent-soft` | `#F3DED3` | accent backgrounds (selected states, chips) |
| `ok` | `#4C7A5A` | done, streak alive |
| `warn` | `#B88A2A` | due today, grace window |
| `danger` | `#A63D2F` | overdue, streak broken, missed |

Domain colors (used as a 3px left edge on rows, a dot on chips, and the project header tint; never as full backgrounds):

| Domain | Color |
| :---- | :---- |
| Personal | `#7A8C6E` sage |
| Almedia | `#3F5F7A` slate blue |
| Tarifa | `#8A5A3C` walnut |
| Misc | `#7A6C8A` mauve |

Dark mode (system-following, must exist because the phone is used in bed): `paper` → `#17150F`, `paper-2` → `#221F18`, `ink` → `#EFE9DF`, `ink-2` → `#B3ABA0`, `line` → `#302C24`; accent lightens to `#D4744E`. Domain colors lift \~15% in luminance.

Typography:

- Display and headings: **Fraunces** (variable, optical size on; weight 500–600; slight negative tracking for sizes ≥ 28px). Today's date, screen titles, the top item, the coach read's first line, scorecard numbers.  
- Body and UI: **Inter** (or Geist Sans), 15px base on mobile, 14px on desktop, line-height 1.5. Tabular figures for any number in a table or tile.  
- Mono (small use): **JetBrains Mono** for timestamps in the archive view, keyboard hints.

Type scale: 34 / 28 / 22 / 17 / 15 / 13 / 11\. Section labels are 11px, uppercase, tracked \+0.08em, `ink-2` (not `ink-3` — see the contrast note in §8).

Spacing: 4px base; 16px page gutter on mobile, 32px on desktop; 12px between rows, 28px between sections. Radius: 10px on cards and inputs, 999px on chips and the capture button. Shadows: one only, `0 1px 2px rgba(30,26,22,0.06)`, on floating elements (capture button, sheets).

Motion: 150–200ms ease-out for state changes; a task row completing slides its checkbox to `ok` and fades the row over 300ms then collapses; suggestion swipe follows the finger with a colored underlay (accent for accept, `ink-3` for dismiss); streak increments tick the number up. Nothing bounces.

## 4\. Navigation

**Mobile (≤ 768px):** bottom tab bar with five slots — Today · Tasks · **Capture** (centre, raised circular accent button, 56px) · Routines · More. "More" opens a sheet with Queue (with pending count), People, Notes, Search, Weekly Review, Settings. The Queue also surfaces as a count chip at the top of Today so it is never more than one tap away. Screens push left-to-right; sheets slide from the bottom for create/edit forms.

**Desktop (\> 768px):** left sidebar, 240px, `paper-2`. Sections: Today, Queue (count), Tasks, Routines, People, Notes, Review; then the four domains as a collapsible list with their projects nested; Settings at the bottom. `⌘K` opens a command palette that searches everything and accepts quick-add syntax (`"Send memo to Bernhard fri #tarifa !high"`). `⌘J` opens the capture panel (text by default, mic toggle). Main content max-width 880px, left-aligned; a right rail (280px) appears on Today and Project screens for the calendar and context.

## 5\. Screens

### 5.1 Today

The home. Described here in its end state; per the spec it is progressively enabled (Phase 1 has the task groups and a manual top item only; the schedule strip and queue chip arrive with the Google integration, the proposed top item with the planning phase). Sections without a connected data source are hidden, not shown empty. Top to bottom on mobile:

- Date line in Fraunces ("Tuesday, 15 September") with a small weather-free, decoration-free header. Under it the queue chip ("4 waiting") if non-zero, and a sync-problem chip if any account needs re-auth.  
- **Top item** block: the one proposed (or chosen) task, accent left rule, title in Fraunces 22px, domain chip, the one-line reason ("Due tomorrow, and you have a 3-hour gap after 2pm"). Actions: Done · Block time · Pick another. If none chosen, the block invites a choice from the top 3\.  
- **Schedule** strip: today's calendar events as a compact horizontal timeline (time, title, domain dot). Tapping expands to the list. Shows "First meeting 10:30 · 2.5h of meetings" as a summary line.  
- **Routines** row: each routine as a pill with its name and streak number; tap to mark done; grace-window ones tint `warn`, missed ones `danger`. Long-press → Skip today.  
- **Tasks** list grouped: Overdue (danger label) · Due today · Scheduled today · Rolling over (from yesterday's close-out). Each row: checkbox, title, right-aligned meta (due/time, person avatar initials, project name in `ink-2`), domain color edge. Mirror (Notion) tasks show a small Notion glyph and open externally. Swipe right \= done, swipe left \= reschedule sheet (Tomorrow / This weekend / Next week / Pick date).  
- Empty state when everything's done: a single Fraunces line ("Clear. Anything on your mind?") with a capture button, no illustration.

Desktop: same order in the main column; the right rail holds the full day's calendar and "Coming up this week" (next 7 days of due tasks by day).

### 5.2 Capture

Full-screen on mobile. A large circular record button (accent, 96px) centred in the lower third; above it a live waveform while recording and the elapsed time; below it a small "Type instead" link that swaps to a text field with the keyboard up. Stop → the transcript appears as text at the top, with a subtle "Filing…" state; then filed items appear as cards — task, reminder (a task with a time), note, person update, or routine logged ("Gym · marked done for today") — with the assigned domain and project, each editable inline, with an "Undo" per card. If the AI needed clarification, a one-line banner ("Couldn't find a project called 'Juicy' — filed to Tarifa without a project") with a Fix link. History of recent captures below the fold.

Desktop: a slide-over panel from the right (⌘J), text field focused, mic button beside it, same result cards.

### 5.3 Queue

List of suggestion cards, newest first, grouped under their source ("Email · Bernhard Niesner · 2h ago", "Meeting · Juicy Energy founder call · yesterday"). Each card: kind label (Commitment / Request / Deadline / Follow-up / About a person / Project update), title, the proposed domain/project/person/due as editable chips, an evidence quote in a slightly inset block (Fraunces italic, `ink-2`), confidence shown as a thin bar not a number. Actions: Accept (accent) · Dismiss (text). Mobile swipe right/left. Tapping the source header opens the archived item. Empty state: "Nothing waiting. Last sweep 20 minutes ago."

### 5.4 Tasks, Domain, Project

Tasks: segmented control for domain (All · Personal · Almedia · Tarifa · Misc), filter chips (Open · Done · No date · High · Mirrored), sort (Due · Priority · Recent). Rows identical to Today. Quick-add field pinned at top with the same syntax as the command palette (`#domain/project`, `@person`, `!priority`, a trailing date, `~date` to schedule), with a live parsed preview beneath it (chips for what was recognised).

Domain page: header with domain color, a short stats line (open tasks, done this week, active projects), list of projects/areas as compact cards (name, kind, next due, last activity, dormant flag if \> 14 days), then tasks without a project.

Project page: title (Fraunces 28), kind and status chips, target date with days-remaining, description (markdown), then tabs: Tasks · Notes · Sources (archived emails/meetings/pages linked to this project) · Activity. Actions: Park · Close · Edit. For mirrored Tarifa projects, a persistent "Open in Notion" link in the header.

### 5.5 Routines

Today's routines as large tap tiles in a 2-column grid: name, streak (Fraunces number), 4-week rate as a thin 28-day dot strip (done `ok`, skipped `ink-3` hollow, missed `danger`). Tap \= done with the tick animation; long-press \= skip. Below, "All routines" list with schedule summary and reminder time, and an Add routine button. Routine detail: history calendar heatmap by weekday (this is where "gym misses cluster on Thursdays" becomes visible), best streak, adherence by week sparkline, settings.

### 5.6 People and Person

People: search field, then a list sorted by last contact (most recent first) with a section at top "Overdue follow-ups" if any. Row: initials avatar in domain color, name, relationship line, last contact ("3 days ago"), badge with open owed/owing count.

Person: name (Fraunces 28), relationship, company/role, domain chip, emails, follow-up cadence control ("Every 14 days" stepper). Two columns on desktop / stacked on mobile: **You owe them** (tasks linked to this person with `owner = me`) and **They owe you** (`owner = them`), then Notes, then a timeline of source items (emails, meetings, calendar events) each with a one-line preview, opening the archive item. "Log contact" button sets last contact to now with an optional note. An overflow menu holds Edit and "Merge into…" (pick another person; tasks, notes, emails and source links move across, the duplicate is removed, with an undo toast).

### 5.7 Notes

List grouped by pinned / recent, filter by domain/project/person. Note editor: title in Fraunces, body in a clean markdown editor (no toolbar; light formatting hints on hover on desktop), metadata chips (domain, project, person) in a footer. Autosave.

### 5.8 Search

One field, results in sections: Tasks · Notes · People · Archive (emails, meetings, Notion pages, events). Filter chips per section: domain, date range, person, kind. Archive results show provider glyph, title, snippet with the match highlighted in `accent-soft`, and date. Opening an archive item shows the full cleaned text, participants (linked to People), the source link, and any suggestions/tasks that came from it ("This produced 2 suggestions: …").

### 5.9 Weekly Review (5 steps)

A focused, full-width flow with a step indicator (1 Scorecard · 2 Slipped · 3 Dormant · 4 Ahead · 5 Coach), progress saved between steps, no bottom tab bar while inside.

1. **Scorecard.** A grid of stat tiles (Fraunces numbers, small delta vs 4-week average with an up/down glyph colored `ok`/`danger` by whether the direction is good): tasks completed, on-time rate, routine adherence, queue cleared, captures. Below, a per-domain bar (completed vs created) and a per-routine row with 7 dots. One sentence of machine summary at the top, no adjectives.  
2. **Slipped.** One overdue task at a time, card centred, with its context (project, person, source). Three buttons: Reschedule (opens date picker with quick options) · Drop (asks for a one-line reason) · Delegate (asks who; creates a follow-up owned by them). A counter "4 of 12". You cannot skip a card.  
3. **Dormant.** Same pattern for projects and people with no activity in 14+ days: Revive (requires typing a next action, which becomes a task) · Park · Close.  
4. **Ahead.** Next week as seven columns (mobile: a list by day) showing due tasks and calendar load per day, with a heat tint by hours booked. Below, a "Top 3 for the week" picker: three slots, drag from the list or from the app's suggestions.  
5. **Coach.** The read, typeset like a short letter: first line in Fraunces 22, body in Inter 17 with generous leading, max \~220 words, then a single boxed line "One change for next week" with a checkbox "I'll try this". A small "Regenerate" link. Finish → returns to Today with a quiet confirmation line under the date ("Review done · next Sunday 17:00").

Review history: a page listing past weeks with three sparklines (completion, on-time, adherence) and each week's "one change" and whether it was ticked.

### 5.10 Settings

Grouped list: **Accounts** (connected Google accounts with label, default domain, calendars read, writable calendar, status pill, Reconnect/Remove; Notion integration and database mapping; Granola with plan detected) · **Notifications** (devices, times, quiet hours, per-kind toggles, test push, Pushover fallback) · **Routines** · **AI & Jobs** (last run per job with status, monthly AI spend, sweep interval) · **Data** (export zip, storage used) · **Appearance** (theme).

## 6\. Components (name them this way in the design so the build matches)

`TaskRow` (checkbox, title, meta, domain edge, mirror glyph, swipe actions) · `TopItemCard` · `SuggestionCard` · `RoutinePill` and `RoutineTile` · `StreakNumber` · `DotStrip` (28-day) · `StatTile` (number, label, delta) · `DomainChip` · `PersonAvatar` (initials in domain color) · `EvidenceQuote` · `CoachLetter` · `ScheduleStrip` · `CaptureButton` and `Waveform` · `StepIndicator` · `EmptyState` (one line \+ one action, never an illustration) · `SyncStatusPill`.

## 7\. Copy and tone

Direct, plain, short. Sentences, not fragments with icons. No exclamation marks anywhere in the chrome. No "Great job\!"; the only praise is in the coach read and only when earned. Numbers over adjectives ("12 slipped" not "a few things slipped"). Buttons are verbs (Accept, Dismiss, Block time, Log contact). Empty states are one line and one action. Errors say what happened and what to do ("Tarifa Gmail needs to be reconnected. Reconnect →").

Examples of the voice:

- Morning brief: "Top item: send the Glacier SAFE memo. 3 due today, first meeting 10:30. 4 suggestions waiting."  
- Missed nudge: "Vitamins not logged. Done, or skip today?"  
- Coach opening: "You accepted 22 commitments this week and closed 9\. The gap is entirely Tarifa admin, deferred three weeks running."

## 8\. Accessibility and platform notes

Contrast ≥ 4.5:1 for all readable text on `paper` and `paper-2`: `ink` (\~15:1), `ink-2` (\~6.6:1) and `accent` (\~5:1) pass; `ink-3` (\~2.8:1) deliberately does not, so it is reserved for placeholders, disabled controls and the hollow "skipped" dots — never for labels or meta text that carries information (use `ink-2` for those, including the project name in task rows). Re-check the dark palette the same way. Tap targets ≥ 44px. Respect `prefers-reduced-motion` (drop the slide/collapse animations, keep state changes instant). iOS: safe-area insets on the tab bar and headers; the capture button must not sit under the home indicator. PWA: no browser chrome in standalone mode, so every screen needs its own back affordance.

---

## 9\. Paste-in prompt for Claude Design

> Design a mobile-first progressive web app called LifeOS — a single-user personal operating system. Style: warm editorial planner — light warm paper background (\#F7F3EC), near-black ink text (\#1E1A16), terracotta accent (\#A84B28) used sparingly, hairline dividers (\#E2DBCF), Fraunces for headings and big numbers, Inter for body. No dark dashboard look, no gradients, no heavy shadows, no illustrations, no emoji in the chrome, no exclamation marks. Four life domains each with a muted color used only as a 3px left edge on rows and as dots on chips: Personal sage \#7A8C6E, Almedia slate \#3F5F7A, Tarifa walnut \#8A5A3C, Misc mauve \#7A6C8A. Also provide a dark variant (paper \#17150F, ink \#EFE9DF, accent \#D4744E).  
>   
> Mobile navigation: bottom tab bar — Today, Tasks, a raised circular terracotta Capture button in the centre, Routines, More. Desktop: 240px left sidebar with Today, Queue, Tasks, Routines, People, Notes, Review, then the four domains with nested projects, Settings at the bottom; 880px main column; right rail on Today.  
>   
> Produce these screens at iPhone 15 size and, for Today, Queue, Project and Weekly Review step 5, also a desktop 1440px version:  
> 

> 1. Today — date in Fraunces; a "Top item" block with an accent left rule, the task title at 22px, a domain chip, a one-line reason and three actions (Done, Block time, Pick another); a compact horizontal schedule strip of the day's meetings; a row of routine pills with streak numbers; tasks grouped Overdue / Due today / Scheduled today / Rolling over, each row with checkbox, title, right-aligned meta, domain edge; a "4 waiting" queue chip near the top.  
> 2. Capture — full screen, big 96px terracotta record button in the lower third, live waveform and timer above it, "Type instead" link below; a second state showing the transcript at top and filed result cards (task / note / person update) with editable domain and project chips and per-card Undo.  
> 3. Queue — suggestion cards grouped under their source ("Email · Bernhard Niesner · 2h ago"), each with a kind label, title, proposed chips (domain, project, person, due), an inset italic evidence quote, a thin confidence bar, Accept and Dismiss; show a mid-swipe state with a colored underlay.  
> 4. Tasks — segmented control by domain, filter chips, quick-add field, task rows.  
> 5. Project — Fraunces title, status and kind chips, target date with days remaining, tabs Tasks / Notes / Sources / Activity, and an "Open in Notion" link variant for mirrored projects.  
> 6. Routines — 2-column grid of routine tiles: name, big streak number, a 28-day dot strip (done filled green \#4C7A5A, skipped hollow grey, missed \#A63D2F); a routine detail screen with a weekday heatmap and adherence sparkline.  
> 7. People list and a Person page — initials avatars in domain color, last contact, an "Overdue follow-ups" section; the Person page with "You owe them" / "They owe you" task lists, notes, and a timeline of emails and meetings.  
> 8. Search — one field, results sectioned Tasks / Notes / People / Archive with provider glyphs and highlighted snippets.  
> 9. Weekly Review — five steps with a step indicator: (1) Scorecard of stat tiles with deltas and a per-domain bar; (2) Slipped: one overdue task card at a time with Reschedule / Drop / Delegate and a "4 of 12" counter; (3) Dormant: same pattern for projects with Revive / Park / Close; (4) Ahead: next week by day with calendar load tint and a "Top 3 for the week" picker; (5) Coach: a short letter-style read with the first line in Fraunces 22px, a boxed "One change for next week" line with a checkbox, and a Finish button.  
> 10. Settings — Accounts list (Google accounts with label, default domain, writable calendar, status pill; Notion; Granola), Notifications with quiet hours and a test push button, AI & Jobs with last-run rows and monthly AI spend, Data export.  
> 11. Two push notification mockups on the iOS lock screen: the morning brief ("Top item: send the Glacier SAFE memo. 3 due today, first meeting 10:30. 4 suggestions waiting.") and a missed-routine nudge ("Vitamins not logged. Done, or skip today?").

>   
> Empty states are a single sentence and one action, never an illustration. Copy is direct and free of praise. Name components TaskRow, TopItemCard, SuggestionCard, RoutineTile, DotStrip, StatTile, DomainChip, PersonAvatar, EvidenceQuote, CoachLetter, ScheduleStrip, CaptureButton, StepIndicator, EmptyState.  
