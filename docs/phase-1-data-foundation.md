# Phase 1 — the data foundation

*Written in the `feature(why we chose it)` format: what it does, and the reasoning that
should survive after the code is familiar.*

This phase builds the part of MyInsuranceBro that `PLAN.md` §14 marks **"Opus 5, no
substitutions"** — the schema, the row-level security policies of §4, and the
`SECURITY DEFINER` metric functions of §7. Nothing above the database is in scope here:
per the plan's own framing, the Next.js shell and the lead screens are the work that
becomes routine once these patterns exist.

The reason this is the first thing built, and built carefully:

> a subtly wrong policy leaks every broker's leads and looks fine in testing — `PLAN.md` §14

A permissive policy raises no error. The app works. It just answers questions it should
have refused. That property drives every decision below.

---

## What is here

| File | Contains |
|---|---|
| `supabase/migrations/…000100_extensions_and_types.sql` | Extensions, the `app_private` schema, enums |
| `…000200_core_tables.sql` | The 14 tables of `PLAN.md` §3, all with RLS enabled |
| `…000300_indexes.sql` | Indexes chosen from the access patterns in §5, §7, §8 |
| `…000400_auth_helpers.sql` | **The security predicates.** The visibility rule, defined once |
| `…000500_rls_policies.sql` | Grants and policies for every table |
| `…000600_triggers.sql` | Column guards, derived timestamps, timeline, audit, auth linking |
| `…000700_metric_functions.sql` | The dashboard RPCs, with the scope clamp |
| `…000800_seed_vocabularies.sql` | Traits, sources, insurance types, starter templates |
| `supabase/tests/rls_and_metrics_test.sql` | 36 pgTAP assertions, mostly negative |
| `supabase/seed.sql` | Local dev data: 3 users, 6 leads, a timeline, one issued policy |
| `supabase/config.toml` | Signup disabled on every provider; fixed local OTPs |

---

## The decisions

### `profiles.id` is not `auth.users.id` (because enrolment precedes login)

The admin pre-registers a broker by phone number, and that broker may not log in for days.
So the profile row must be creatable while no auth user exists; `auth_uid` starts null and
is filled by a trigger on first OTP login. The same separation is what makes deactivation
clean — `is_active = false` cuts off access without deleting the row that every lead,
activity and history entry points at.

One detail that costs an afternoon if missed: Supabase stores `auth.users.phone` as bare
digits (`919876543210`) while E.164 in our tables carries the `+`. The link trigger strips
non-digits from both sides. Get it wrong and you get a *working login into an empty app* —
the session is valid, no profile links to it, and every policy correctly returns nothing.

### The visibility rule lives in exactly one place (because two copies drift silently)

`app_private.can_read_lead_row(assigned_to, is_private)` and `can_write_lead_row(...)` are
the whole of `PLAN.md` §4. Every policy on `leads` and on every child table routes through
them. The read rule and the write rule are deliberately different — open mode grants
**read** to the org, not write, which is what makes the plan's "non-owners get a read-only
view" real rather than a UI convention.

`can_read_lead(uuid)` / `can_write_lead(uuid)` are the same predicates addressed by lead
id, for child tables. They are `SECURITY DEFINER` so the lookup itself is not filtered —
and that is not a loophole, because the row they fetch is immediately fed through the same
predicate the `leads` policy uses. A missing lead returns `false`, not an error, so the
functions cannot be used as an existence oracle either.

### Helpers are `SECURITY DEFINER` with `search_path = ''` (because both are load-bearing)

Definer is not stylistic. `is_admin()` reads `public.profiles`, whose own policy calls
`is_admin()`. As an invoker function that is infinite recursion; as a definer function it
bypasses RLS on `profiles` and terminates.

The pinned `search_path` is what stops that same definer privilege from becoming an
escalation: without it, a caller can point `public` at a schema they control and substitute
the table the function reads. Every function in this phase sets it and schema-qualifies
every identifier.

Helpers live in `app_private`, which PostgREST does not serve — `config.toml` exposes only
`public` and `graphql_public`. `authenticated` is granted `usage` on it anyway, because a
policy expression is evaluated with the *calling* role's privileges; without the grant,
every query would fail with a permission error rather than filter.

### Column rules are triggers, not policies (because RLS is row-level)

RLS can say "you may update this lead". It cannot say "…every column except
`assigned_to`". Column privileges cannot help either: admin and broker are both the
Postgres role `authenticated`, and a `GRANT` cannot tell them apart — the role distinction
lives in our `profiles` table, not in the database's role system.

So the reassignment rule, the privacy-flag rule, and the "a broker cannot promote
themselves to admin" rule are `BEFORE` triggers that **raise**. Raising matters: a silently
discarded change looks identical to a successful one from the client.

The self-promotion guard is the sharpest of these. Without it, the `profiles_update` policy
clause `or id = me` — which exists so a broker can edit their own display name — would let
any broker set their own role to `admin`.

### Metrics clamp the caller's scope, they do not validate it

Every dashboard function is `SECURITY DEFINER` and therefore reads past RLS by design; an
org-wide leaderboard has to aggregate rows the caller cannot select individually. That
makes each one its own API endpoint, so each re-establishes the caller's rights itself.

`app_private.resolve_metric_scope(p_broker_id)` is the only place a broker id parameter is
interpreted. For a non-admin it returns the caller's own id **whatever was passed** —
`PLAN.md` §7's "no matter what the client asks for". Functions that are inherently org-wide
(`broker_leaderboard`, `source_performance`, `unattended_leads`) raise for a non-admin
instead of clamping, because a leaderboard clamped to one row is a confusing half-answer
where a refusal is honest.

`revoke ... from public, anon` on each function is not redundant: a `SECURITY DEFINER`
function is executable by everyone by default, and `anon` inherits from `public`.

### Conversion rate is a cohort measure

`leads converted this month ÷ leads received this month` mixes two populations and can
exceed 100% in a month where a backlog closes. `broker_metrics` instead asks: of the leads
*received* in this window, how many have since converted. Slower to move, and actually
comparable against the previous period.

Timestamps that feed metrics (`first_contacted_at`, `converted_at`, `lost_at`) are derived
by triggers rather than sent by the client, so a screen that forgets a field cannot skew
the numbers. "First contact" specifically means the first *outbound* call, WhatsApp, email
or meeting — a note does not count as having contacted anyone.

### The audit log is selective on `leads`, full on configuration

`PLAN.md` §11 asks for a trail of reassignment, status changes, exports and visibility
flips. It does not ask for every keystroke, and logging every column would copy client PII
and health hints out of `leads` into a second table with a different retention story —
the opposite of what DPDP compliance wants. So `leads` audits assignment, status and the
privacy flag; `profiles`, `org_settings` and `templates` audit full diffs, because they
hold configuration and staff records rather than client data.

No policy grants `insert`, `update` or `delete` on `audit_log` to any client role,
including admin. It is written only by definer triggers.

---

## Threat model — what the tests actually assert

| Attack | Defence | Test |
|---|---|---|
| Broker queries another broker's lead by id, bypassing the UI | `leads_select` policy | "cannot see broker B's lead by id" |
| Broker reads a colleague's timeline in closed mode | `can_read_lead` on `lead_activities` | "sees none of broker B's timeline" |
| Broker edits a lead they can only read in open mode | `can_write_lead_row` is narrower than read | "the row is untouched, not just the response" |
| Admin's private VIP lead exposed when the switch flips to open | `is_private` short-circuits both rules | "is_private still hides a lead from non-owners" |
| Broker hands themselves a colleague's lead | `guard_lead_columns` + `leads_update` WITH CHECK | "cannot reassign a lead away from themselves" |
| Broker promotes themselves to admin | `guard_profile_columns` | "cannot promote themselves to admin" |
| Deactivated broker keeps reading data | `current_profile_id()` filters on `is_active` | "a deactivated broker sees nothing" |
| Broker logs an activity under a colleague's name | `actor_id = current_profile_id()` in WITH CHECK | "cannot log an activity under another broker's name" |
| Broker rewrites status history to fake a conversion | no client INSERT policy exists | "status history cannot be written by a client" |
| Broker calls the org metrics RPC with someone else's id | `resolve_metric_scope` clamp | "clamps a broker to their own slice" |
| Unauthenticated caller reads anything | every policy is `to authenticated` | "anon sees nothing" |

Note the shape: the assertions that matter are the ones counting **zero**. "Broker A can
see their own lead" passes just as happily against a policy that returns everything.

---

## Running it

```bash
supabase start
```

```bash
supabase db reset
```

```bash
supabase test db
```

`supabase test db` runs the pgTAP suite. It needs the local stack, which needs Docker.

**Verification status, stated plainly:** every migration, the test suite and the seed file
parse cleanly against the real PostgreSQL grammar (libpg_query), and all eleven
`language sql` function bodies and all seven `return query` blocks in the metric functions
parse individually. They have **not** been executed — this machine has no Docker, so no
local Supabase stack could be started. The 36 assertions are written but unrun. Run
`supabase test db` before treating any of the guarantees above as verified.

---

## What Phase 1 leaves for the next phase

- **Storage.** No bucket or policy for the Documents tab yet; it belongs with the upload UI.
- **Realtime.** No publication configured. `PLAN.md` §13 notes the `fe-gmq` polling
  fallback; Supabase Realtime respects RLS, so this is additive when the leads list needs it.
- **`assigned_at`.** `unattended_leads` measures from `created_at`, since nothing records
  when a lead was last assigned. If reassignment should reset the clock, that needs a column.
- **CSV import.** §2 requires chunked batches to stay inside the serverless execution cap.
- **`pg_cron`.** The follow-up reminder and renewal sweeps of §2 have their data in place
  (`next_follow_up_at`, `policies.renewal_date`) but no schedule attached.
- **Team Lead role.** The `user_role` enum has two values. A third would need its own
  branch in `can_read_lead_row` and a sub-team relation on `profiles`.
