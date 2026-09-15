# DECISIONS.md — log of decisions the spec left open

Per SPEC.md: every decision made during the build that the spec did not settle gets a dated entry here, with the reasoning. Decisions already made in the planning conversation live in SPEC.md §12 and CLAUDE.md §3 and are not repeated.

Format: `date — decision — reasoning — decided by (Joshua / Claude Code, confirmed by Joshua / Claude Code, spec-consistent default)`.

---

- **2026-09-15 — Repository bootstrapped with docs only; no application code yet.** The spec's own placement rules applied: `SPEC.md` and `DESIGN_BRIEF.md` copied to `/docs`, `CONTEXT.md` became `CLAUDE.md` at the repo root so every future Claude Code session loads it automatically. `docs/SETUP.md` added as the pre-Phase-0 checklist of external accounts, keys and decisions (the spec lists the env vars but not the acquisition steps). Decided by: Claude Code, spec-consistent default.

<!-- Pending entries the spec explicitly expects:
- Google OAuth consent screen set to "In production" (or the Testing + token-expiry-alert fallback) — log when done, per SPEC §6.1.
- Granola plan confirmed (Basic vs Business) → which adapter is active — per SPEC §6.3.
- Which Notion databases/pages are mirrored and the property mapping — per SPEC §13.2.
- The app's domain name — per SPEC §13.3.
-->
