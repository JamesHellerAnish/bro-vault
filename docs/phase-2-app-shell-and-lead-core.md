# Phase 2 — app shell and lead core

*Continues [phase-1-data-foundation.md](phase-1-data-foundation.md). Same
`feature(why we chose it)` format.*

This phase puts an app on top of the database: the Next.js scaffold, the ported theme, phone
OTP auth, the app shell, and the working lead screens. In `PLAN.md` §9 terms it is the
second half of Phase 0 plus the bulk of Phase 1 (Lead core) — the schema half was built
first because §14 marks it as the part that must not be got wrong.

---

## What is here

| Area | Files |
|---|---|
| Scaffold | `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `middleware.ts` |
| Theme | `app/broker-theme.css` — ported from `fe-gmq`, 574 lines |
| Data access | `lib/supabase/{client,server,types}.ts`, `hooks/{useLeads,useMetrics,useOrg,useNotifications}.ts` |
| Auth | `lib/auth/useAuth.tsx`, `components/broker/{BrokerAuthGate,LoginScreen,BrokerSplash,NotEnrolledNotice}.tsx` |
| Shell | `components/broker/{BrokerAppShell,BrokerBottomNav,BrokerSidebar,BrokerTopBar}.tsx` |
| Screens | `app/(app)/{dashboard,leads,leads/[id],leads/new,follow-ups,profile}/page.tsx` |
| Lead UI | `components/leads/{LeadCard,LeadTimeline,WhatsAppComposer}.tsx` |
| Migration | `supabase/migrations/…000900_confirm_optimistic_sends.sql` |

---

## The decisions

### The theme is a port, not a rewrite

`fe-gmq`'s `partner-theme.css` came across whole, with two changes: `--p-brand` moves from
red `#E53935` to deep blue `#1E4E9C` (`PLAN.md` §12 item 8 — insurance reads as trust,
and red reads as alert), and a block is appended for the things this product has and that
one did not: pipeline badges keyed to `lead_status`, a temperature dot, trait chips keyed to
**trait category** rather than to individual traits, a read-only bar, and the sticky action
bar from §5.

Trait chips are coloured by category on purpose. `public.traits` is an admin-editable table,
so per-trait CSS would go stale the first time someone adds a trait from the panel.

### No visibility logic in the client

`hooks/useLeads.ts` asks for "all leads" and renders whatever comes back. There is no
`if (broker) filter(...)` anywhere in the app, because the database already decided. A
client-side filter would be theatre — and worse, a second copy of the rule that can drift
from the real one.

The same applies to metrics: `useMetrics.ts` passes `p_broker_id` straight through without
checking anything, because `resolve_metric_scope` clamps it server-side. The client copy of
a security rule is always the fake one.

### An RLS-blocked write returns zero rows, not an error

This is the sharpest edge in the whole app. `update ... where id = x` on a row the policy
refuses is a **successful** statement affecting nothing. A naive mutation shows a success
toast for a change that never happened.

So `useUpdateLead` selects the updated row back and throws when it is null:

```ts
if (!data) throw new Error('You do not have permission to edit this lead.')
```

`canEdit` in the lead detail screen is presentation only — it decides whether to *draw* the
controls. If it were computed wrongly, the write would still fail loudly rather than
silently succeed.

### The two `fe-gmq` auth fixes, inherited deliberately

`PLAN.md` §13 flags both, and both are in `lib/auth/useAuth.tsx`:

1. **The splash gates on `initialCheckComplete`, not `loading`.** `loading` also flips
   during an OTP request, so gating on it unmounts the login form mid-flow and wipes the
   number the broker just typed. It presents as a random, hard-to-reproduce bug.
2. **A staleness counter.** The initial session lookup is async; if it resolves *after* a
   fresh login lands, it would overwrite the new session with "no session". Every state
   write carries its run number and is discarded if a newer run has started.

A third detail is this product's own: the profile comes from the `me()` RPC rather than a
select on `profiles`. `me()` is `SECURITY DEFINER` and returns nothing for a deactivated
broker — which is exactly the signal the auth gate needs, and one a policy-filtered select
would express less clearly.

### WhatsApp Option A, including the part that is uncomfortable

`WhatsAppComposer` opens `wa.me` with a merged template. We cannot observe whether the
broker actually pressed send, so the activity is written with `is_optimistic = true` and the
timeline renders it differently, with a one-tap "did this send?" prompt — the mitigation
`PLAN.md` §6 asks for.

Rendering an optimistic entry identically to a confirmed one would quietly convert *"I
opened WhatsApp"* into *"the client was messaged"*, and that number would then flow into a
conversion report. Unfilled merge fields stay visible as `{{name}}` for the same reason:
better a broker sees the gap than a client receives "Hello ,".

### One migration this phase forced

Building the confirm-send prompt surfaced a genuine conflict: the Phase 1 policy
`lead_activities_update_own_note` allows updates only on `type = 'note'`, so the prompt
could not write its own outcome.

The original policy is right about the principle — the timeline is evidence, and a broker
must not be able to rewrite what a call said afterwards. So
`…000900_confirm_optimistic_sends.sql` does not widen it to "authors may edit their
activities". It grants exactly one transition: *the author of an unconfirmed entry may
record whether it went out*, once, while `outcome is null`. A trigger freezes every other
column, following the same split as the rest of the schema — RLS picks the rows, a trigger
picks the columns.

Worth noting the direction of travel: the UI was changed to fit the security model in one
place and the security model was extended by a precise amount in another. The failure mode
to avoid is relaxing a policy because a screen was already built.

### The Supabase browser client is built inside the data functions, not in hook bodies

This started as a build failure and turned out to be a design bug worth naming.

Every hook originally opened with `const supabase = getSupabaseBrowserClient()` in the
component body. That body runs during Next's server prerender, so the factory — which throws
a helpful "copy .env.example" error when the public env vars are unset — fired at **build
time**. The first green build was green only because a `.env.local` happened to exist.

Two things were wrong, and the smaller one was the error message:

- A production build should not depend on runtime environment variables. `NEXT_PUBLIC_*`
  values are inlined at build time, so a CI job that injects them at deploy time would have
  failed here for reasons that look nothing like the cause.
- More to the point, a *browser* client was being constructed on the server on every render
  of every authenticated screen. Nothing wanted that.

So the client is now created inside each `queryFn` / `mutationFn` and inside the auth
callbacks — all of which run only in the browser. `pnpm build` now succeeds with no `.env`
file at all, which is what a fresh clone looks like.

The general shape is worth keeping in mind: a guard that throws helpfully in development can
fire somewhere you did not intend it to run. The fix was to stop running it there, not to
soften the guard.

### Middleware refreshes, it does not guard

`middleware.ts` refreshes the Supabase session cookie so Server Components see a live
session, and deliberately does no route gating. Authorisation is RLS; a redirect is a UX
affordance `BrokerAuthGate` already provides. Adding route rules here would create a second
place to keep the role logic correct.

### Cohort conversion, rendered as such

The dashboard shows "of the leads received in this window, the share that has converted",
with the previous period beside it — not `conversions ÷ leads` over the same month, which
mixes populations and can exceed 100%. The card says so in one line, because a metric
nobody can explain gets ignored.

---

## Screens

| Route | State |
|---|---|
| `/login` (rendered by the gate, not a route) | Phone + OTP, resend cooldown, auto-submit on the 6th digit |
| `/dashboard` | Stat cards, funnel, trend vs previous period; admin also gets leaderboard + unattended leads |
| `/leads` | Search (name *and* phone-substring), pill tabs per stage, infinite scroll, FAB |
| `/leads/[id]` | Header, sticky Call/WhatsApp/Email bar, Details + Timeline tabs, traits, status, follow-up |
| `/leads/new` | Quick-add: name + phone required, everything else behind "More details", consent checkbox |
| `/follow-ups` | Today / Overdue / Upcoming agenda |
| `/profile` | Info, org visibility mode, sign out |

Not built yet: `/team`, `/settings`, `/notifications` are linked from the nav but have no
page. They are admin surfaces and belong with the rest of the admin work.

---

## Verification status

`pnpm typecheck` passes clean under `strict` **and** `noUncheckedIndexedAccess`, and
`pnpm build` compiles. Neither `next.config.mjs` flag that `fe-gmq` sets
(`ignoreDuringBuilds`, `ignoreBuildErrors`) is enabled, so those results mean what they say.

**The app has not been run against a live database.** There is still no Docker on this
machine, so no Supabase stack could be started, no login was performed, and no query has
actually returned a row. Every screen is written against the schema and typed against it;
none is confirmed working end to end. The first run will find things — that is what a first
run is for.

To do that run, see the setup section in [README.md](../README.md).

---

## What is next

- **Admin surfaces** — `/team` (invite, deactivate, reassign), `/settings` (the visibility
  switch, traits, templates, sources).
- **Realtime** — swap the 30s notification poll for a Supabase Realtime subscription. It
  respects RLS, so it is additive.
- **Storage** — the Documents tab on a lead needs a bucket and its own policies.
- **Phase 4, Capacitor** — `PLAN.md` §13's live-URL wrap. The viewport already sets
  `viewportFit: cover` and the theme has the safe-area helpers, so the shell is ready for it.
- **`assigned_at`** — still outstanding from Phase 1; `unattended_leads` measures from
  `created_at`.
