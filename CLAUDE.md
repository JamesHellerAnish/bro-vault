# CLAUDE.md — MyInsuranceBro house rules

Read `PLAN.md` first. It is the product + technical spec; this file is only how we work in the repo.

## What this product is

A client & lead management platform for an insurance brokerage. One Next.js codebase →
responsive web → wrapped with Capacitor into an Android app. Backend is Supabase
(Postgres + Auth + RLS + Storage + Edge Functions).

**The app makes zero LLM calls in production.** Claude writes the code; nothing here calls a model at runtime.

## The one rule that matters most

**Lead visibility is enforced in Postgres, not in the UI.** Hiding a row in a React
component is not security. If you add a table that holds client data, it gets RLS
enabled and explicit policies in the same migration that creates it — never a follow-up.
A broker must not be able to read another broker's lead by hand-crafting a request.

Corollary: never ship the `service_role` key to the client. Privileged work runs in
Edge Functions or `SECURITY DEFINER` functions that check the caller's role themselves.

## Database conventions

- Migrations are append-only. Never edit a migration that has been pushed — write a new one.
- Every `SECURITY DEFINER` function sets `search_path = ''` and schema-qualifies every
  identifier. Without this it is a privilege-escalation hole.
- Policy predicates wrap parameterless helper calls in `(select ...)` — e.g.
  `(select app_private.is_admin())` — so Postgres evaluates them once per statement
  instead of once per row.
- Helpers live in `app_private`, which PostgREST does not expose. Only `public` is reachable
  from the client. Putting a helper in `public` makes it a public API — do it deliberately or not at all.
- The visibility predicate is defined **once**, in `app_private.can_read_lead_row` /
  `can_write_lead_row`. Policies call it. Do not re-implement the rule inline anywhere.
- Deactivating a broker (`profiles.is_active = false`) revokes all data access immediately,
  because `current_profile_id()` filters on `is_active`. History is preserved.

## Code conventions

- TypeScript strict. `next.config` must **not** set `ignoreDuringBuilds` or
  `ignoreBuildErrors` — `fe-gmq` does and it ships type errors to production (PLAN.md §13).
- No hardcoded backend URLs or keys in source. Environment variables only.
- Never read, write, or commit `.env*` files.
- One package manager: **pnpm**, and for Capacitor it is load-bearing rather than stylistic:
  `cap sync` writes `android/capacitor.settings.gradle` with paths into pnpm's store. An npm
  or yarn install produces a flat layout, those paths vanish, and Gradle fails at settings
  evaluation with an error naming neither cause. Do not commit a second lockfile.
- Run `pnpm cap:sync` after any `pnpm install` that changes dependencies. The generated Gradle
  files are gitignored specifically so they are always rebuilt for the layout present.
- Data fetching goes through TanStack Query, not `useState` + `useEffect`.

## Documentation

Docs are written as `feature(why we chose it)` — the rationale is the point, because the
decision outlives the code. `docs/phase-1-data-foundation.md` is the format to copy.

## Working style

- Plan before code. For anything touching RLS or metrics, state the threat model first.
- One task per session. Scaffolding auth, building the leads list, and debugging Gradle
  in one session carries all three contexts through every later request.
- Point at files, don't paste them. The 1M context window is a ceiling, not a target.
- An example is representative — fix the whole pattern, not just the cited case.
- Report honestly what was run and what was not. An untested migration is described as untested.
