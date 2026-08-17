# Phase 3 — admin surfaces

*Continues [phase-1-data-foundation.md](phase-1-data-foundation.md) and
[phase-2-app-shell-and-lead-core.md](phase-2-app-shell-and-lead-core.md). Same
`feature(why we chose it)` format.*

This phase builds the three admin-only screens Phase 2 left as nav links with no page:
`/team`, `/settings`, `/notifications`. ~2,100 new lines, entirely on Sonnet — every piece
here fit the pattern Phase 2 established (a hook that throws on an RLS-refused write, a
component that draws around it), with no new security boundary to design. That call was
made explicitly before starting and held for the whole phase.

---

## What is here

| Area | Files |
|---|---|
| Team data | `hooks/useTeam.ts` |
| Settings data | `hooks/useAdminOrg.ts`, `hooks/useNotifications.ts` (extended) |
| Guard | `components/broker/AdminOnly.tsx` |
| Team UI | `components/team/{InviteBrokerSheet,ReassignSheet}.tsx` |
| Settings UI | `components/settings/{OrgSettingsPanel,TraitsPanel,VocabularyList,TemplatesPanel,TemplateEditorSheet}.tsx` |
| Screens | `app/(app)/{team,team/[id],settings,notifications}/page.tsx` |
| Small extensions | `lib/status.ts` (`TRAIT_COLORS` exported), `lib/format.ts` (`slugify`, `extractVariables`) |

No new migration. Checked before writing anything: `guard_profile_columns` and
`guard_lead_columns` (Phase 1) both bypass entirely for `is_admin()`, so invite,
deactivate/reactivate, and lead reassignment all work against the existing schema. The one
close call — the confirm-send prompt in Phase 2 — needed a migration because it touched a
security *rule*; this phase only touches security *reach* (an admin doing more of what
admins could already do), which is a different thing and didn't need one.

---

## The decisions

### "Invite" is just creating the profile row

There is no invite email, no signup link, no token. `useInviteBroker` inserts a
`profiles` row with a phone number; the broker links to it on their first OTP login via
`app_private.link_auth_user_to_profile` (Phase 1). This isn't a shortcut — `PLAN.md` §1 is
explicit that there's no public signup, so the profile row *is* the enrolment. Telling the
broker their number is active is a phone call, not a feature.

One real edge case this surfaces: `profiles.phone` is `UNIQUE`. Re-enrolling a number
already in the directory throws Postgres `23505`, caught and turned into "Someone is
already registered with this phone number" rather than a raw constraint-violation string.

### Reassignment is one component, used in two places

`ReassignSheet` — pick an active broker — is used from the ⇄ control (implicit in the
`PLAN.md` §5 wireframe: `Assigned: Ankit (Admin: ⇄)`, added to the lead detail screen this
phase) and from a broker's open-leads queue on `/team/[id]`. Both are the same action:
hand N leads to someone else. Only active brokers are offered as targets — reassigning
*to* a deactivated broker would hand a lead to someone who can no longer see it.

Single-lead reassignment reuses Phase 2's `useUpdateLead(leadId)` rather than a new hook —
it already accepts `Partial<Lead>` and already throws on an RLS-refused write, so adding a
parallel `useReassignLead` would have been a second, untested copy of logic that exists and
works. Bulk reassignment (`useBulkReassignLeads`) is a genuinely different shape — one
`.update().in('id', leadIds)` call instead of N — and gets its own hook, which checks the
returned row count against the requested count rather than assuming a batch either fully
succeeds or fully fails.

### Deactivating a broker is blocked in the UI while they still hold open leads

`PLAN.md` §1: deactivation "keeps their history intact and pushes their open leads to a
reassignment queue." The database doesn't enforce an ordering here — an admin *could*
deactivate someone through raw SQL while they still have twelve open leads, and nothing
would break; the leads would just sit assigned to an inactive profile, still fully visible
and editable by the admin. But that's a queue nobody would remember to clear. So
`/team/[id]`'s deactivate button checks `openLeads.length` client-side first and refuses
with a specific count, pointing at the reassignment list right above it. Presentation
discipline, not a missing constraint.

### Traits, sources and insurance types are soft-deleted, never hard-deleted

All three schemas are already built for this — `is_active` exists specifically so "you can
add or rename them from the admin panel without a code change" (`PLAN.md` §3) doesn't turn
into "you can also silently corrupt every lead that used a value you deleted." Hard-deleting
a trait would cascade-delete every `lead_traits` row referencing it (`on delete cascade`);
hard-deleting a source would null out `source_id` on every lead that used it. Neither is
reversible, and neither has any upside the toggle doesn't already provide. So
`useSetTraitActive` / `useSetLeadSourceActive` / `useSetInsuranceTypeActive` only ever flip
a flag, and the UI in `VocabularyList` and `TraitsPanel` never offers a delete button at all
— it isn't hidden behind a confirm dialog, it doesn't exist as an option.

### The visibility switch commits per-field, not behind one Save button

`OrgSettingsPanel` fires a mutation the moment a toggle changes or a text field blurs, with
its own toast. A single "Save all" button risks a half-typed business-hours edit going out
bundled with a visibility flip the admin meant to commit alone — and the visibility switch
is the one setting on this whole screen where "did that just actually take effect" needs to
be answerable immediately, not after a batched submit.

### Template variables are detected, never hand-typed

`extractVariables()` runs the identical `{{\w+}}` regex `renderTemplate()` and
`missingVariables()` already used in Phase 2's `WhatsAppComposer`. A template editor with a
separate "variables" field the admin fills in by hand would be a second copy of what the
body text already says, and the two would drift the first time someone edits the message
without remembering to update the list. What the editor shows as "variables in this
template" is mechanically the same thing the composer will later look for.

### `AdminOnly` is presentation, following the pattern from Phase 2's `canEdit`

The nav already hides `/team` and `/settings` links from a broker, but the routes are still
reachable by typing the URL. `AdminOnly` redirects a non-admin to `/dashboard` — without it,
that broker would land on a page that fires `broker_leaderboard()` and
`profiles_insert_admin`-gated writes, and see nothing but a wall of "insufficient
privilege" toasts. If this component were deleted outright, the *data* shown would still be
nothing; only the experience of getting there would get worse. It decides what to draw, the
database still decides what anyone actually receives.

---

## Screens

| Route | State |
|---|---|
| `/team` | Active / Deactivated tabs, invite sheet, per-row deactivate/reactivate |
| `/team/[id]` | 30-day stats (reused `broker_metrics` RPC, pointed at someone else), open-leads queue with checkbox multi-select + bulk reassign, single-lead reassign, deactivate blocked while leads are open |
| `/settings` | Organisation (visibility switch, cross-broker-edit, unattended-alert threshold, org name) / Traits / Sources / Insurance / Templates |
| `/notifications` | List, mark-one-read on open, mark-all-read; `lead_assigned` renders with a name and a link, anything else falls back to a generic line |

`/leads/[id]` also gained the reassign control this phase — the ⇄ from the §5 wireframe
that Phase 2 had not built yet.

---

## Verification status

`pnpm typecheck` passed clean on the first attempt — no iteration needed this phase, which
is itself a small data point for the Sonnet-is-enough call: the failure modes that needed
Opus in Phases 1–2 (RLS design, a client constructed at the wrong time) didn't recur here
because there was no new boundary to get subtly wrong.

`pnpm build` succeeded with **no `.env` file present**, same bar as Phase 2. All 11 routes
built — `/`, `/dashboard`, `/follow-ups`, `/leads`, `/leads/new`, `/leads/[id]`,
`/team`, `/team/[id]`, `/settings`, `/notifications`, `/profile`.

**Still never run against a live database.** No Docker on this machine, so nothing in this
phase — invite, deactivate, reassign, the settings toggles, template CRUD — has executed
against real RLS yet. Every write path is typed against the schema and reasoned through
against the actual policy and trigger definitions (quoted above, not assumed), but "the
migration says admin bypasses this trigger" and "I watched admin bypass this trigger" are
different claims. The first live run is still the one that will find what reasoning missed.

---

## What is next

- **Storage** — the Documents tab still needs a bucket and its own policies. Flagged in
  Phase 2 as Opus-worthy: storage RLS is the same class of problem as `PLAN.md` §4, and a
  wrong policy here would expose a client's uploaded medical documents.
- **The first live run** — connect to a real Supabase instance, execute the 36 pgTAP
  assertions, and walk every screen in this phase against real data. Whatever it turns up
  gets fixed before anything past this point is trusted.
- **Realtime** — still on the 30-second notification poll from Phase 2.
- **Capacitor (Phase 4)** — unblocked now that the admin surfaces exist; nothing in this
  phase touched anything Capacitor-relevant.
