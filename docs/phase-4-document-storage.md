# Phase 4 — document storage

*Continues [phase-3-admin-surfaces.md](phase-3-admin-surfaces.md). Same
`feature(why we chose it)` format.*

The Docs tab from `PLAN.md` §5's wireframe, and the "document storage" line from §9's
Phase 5. Built on Opus deliberately: this was flagged in Phase 2 as the one remaining item
that is the same class of problem as §4, and the blast radius is worse than a leaked lead
row. A lead row exposes a name and a phone number to a colleague inside the same brokerage.
An object is a downloadable medical report that can be forwarded outside it, cached, and
indexed — and unlike a row, it stays leaked after the policy is fixed.

---

## What is here

| File | Contains |
|---|---|
| `…001000_lead_assignment_time.sql` | `leads.assigned_at`, and `unattended_leads` re-pointed at it |
| `…001100_lead_documents.sql` | Metadata table, its policies, timeline + audit triggers |
| `…001200_storage_documents.sql` | The private bucket, path parsing, `storage.objects` policies |
| `supabase/tests/documents_rls_test.sql` | 25 pgTAP assertions, half of them about hostile paths |
| `hooks/useDocuments.ts` | Upload, delete, signed-URL minting |
| `components/leads/DocumentsTab.tsx` | The Docs tab |

---

## The decisions

### Two stores, two policy sets, and both are required

The file lives in Supabase Storage; its metadata lives in `public.lead_documents`. Each
needs its own policies, because either one alone is a hole:

- **Metadata-only protection** — the file is still fetchable from Storage by path.
- **Storage-only protection** — the file is safe, but the listing leaks filenames. And a
  filename on an insurance lead (`kolkata-diabetes-report.pdf`) is health data about a named
  person under the DPDP Act. That is the leak, not a lesser version of it.

So the visibility rule is applied twice, independently, through the same shared predicates
(`can_read_lead` / `can_write_lead`) that every other table routes through.

### The bucket is private, and that is the load-bearing token

`public = false` is the single most important thing in this phase. A public bucket serves
every object at a stable URL **with no policy evaluation at all** — RLS on `storage.objects`
is simply not consulted for public reads. Every policy written here would still exist, still
review as correct, and protect nothing.

The `on conflict do update set public = false` on the bucket insert re-asserts it on every
migration run, so it cannot drift true later, and the test suite asserts it as test zero —
before anything else, because every other assertion is meaningless if it fails.

Reads therefore go through 60-second signed URLs. Minting one runs the SELECT policy, so a
broker who cannot see the lead cannot mint a link to its documents even knowing the path.

### The storage path carries no filename

Objects are `<lead_id>/<document_id>.<ext>`, never
`<lead_id>/medical-report-diabetes.pdf`. A signed URL is a bearer token that gets pasted
into WhatsApp threads and written to proxy logs; a path of two UUIDs discloses nothing if it
escapes, while a descriptive filename discloses a health condition attached to an
identifiable person. The human filename lives in `lead_documents.file_name` and is applied at
download time.

This is also *why the metadata table exists* rather than just listing `storage.objects` —
the filename has to live somewhere other than the path, and `uploaded_by` needs to be a
`profiles.id` (`storage.objects.owner` is an `auth.users` id, a different key).

### The lead is re-derived from the path, and unparseable paths fail closed

`storage.objects` has no `lead_id` column and one cannot be added, so the first path segment
*is* the lead id and the policies re-derive it on every access.

`app_private.lead_id_from_storage_path()` regex-guards before casting. That guard is
load-bearing: a bare `split_part(name,'/',1)::uuid` raises `22P02` on a path like
`foo/bar.pdf`, and inside a policy that aborts the whole statement rather than filtering the
row. It happens to fail closed — but it turns an ordinary listing into an error, and
error-vs-empty is exactly the kind of difference that gets "fixed" later by loosening the
policy. Null flows into `can_read_lead(null)`, which the Phase 1 `coalesce(..., false)`
already turns into a denial. Seven of the 25 assertions are about this function alone.

### `UPDATE` on storage.objects exists to stop a file being *moved* across the boundary

Easy to omit, since nothing in the UI renames an object. But a policy-less `UPDATE` would
let a writer on lead A rename an object into lead B's folder — moving a file across the
visibility boundary without ever reading it. `USING` checks where it is now, `WITH CHECK`
checks where it is going, so a move is only possible between two leads the caller may
already write.

### Deletion is narrower than upload, and the refusal is checked

Uploading requires write access to the lead. Deleting requires being the uploader, or an
admin — a broker who can merely *edit* a lead does not get to remove a colleague's evidence.

`useDeleteDocument` checks the returned row and throws when it is empty, for the reason
established in Phase 2 but with sharper stakes here: an RLS-blocked delete removes zero rows
without erroring, and reporting a successful deletion that did not happen is a compliance
problem on an erasure request, not just a UI bug.

### One gap recorded rather than papered over

Deleting a lead cascades `lead_documents` but does **not** remove the objects from Storage.
This is not fixable from SQL: deleting a row from `storage.objects` unlinks it from the
listing without removing the underlying object, so a trigger would replace a visible orphan
with an invisible one — strictly worse, because the invisible one cannot be swept later. The
real fix is an Edge Function or a `pg_cron` sweep (§2 already establishes `pg_cron` as this
project's scheduler). Until then, admin lead-deletion leaves orphaned files. Written down in
the migration, not just here.

---

## The `assigned_at` fix, finally

Carried since Phase 1 and flagged in both prior docs. `unattended_leads` measured "how long
has this sat untouched" from `created_at`, which made the alert wrong in the exact case it
exists to catch: reassigning a three-week-old stalled lead gave the new broker something
already ~500 hours "unattended" on arrival. It screamed on their first day with it, and an
alert that is always red is not an alert.

Two things this surfaced that were not obvious going in:

**The return type changed, so `CREATE OR REPLACE` could not be used.** Adding `assigned_at`
to the `RETURNS TABLE` makes it a different function as far as Postgres is concerned —
`cannot change return type of existing function`. The migration drops first.

**The trigger cannot unconditionally stamp `now()`.** Doing so silently broke the seed: every
backdated lead got today's date, and the unattended-lead fixture stopped demonstrating
anything. It would have broken the Phase 5 CSV import the same way. So the column has **no
default** (a default would fill the value before the trigger runs, making "caller supplied
nothing" indistinguishable from "caller supplied a date"), and the trigger honours a supplied
value only for admins and profile-less contexts — service_role, migrations, `seed.sql`. A
broker's value is always discarded, because the abuse case is real: dating a lead *forward*
hides it from the admin's alert panel forever.

---

## Verification status

`pnpm typecheck` passes clean. All four SQL files parse against the real PostgreSQL grammar.

Two genuine bugs were caught by review before they shipped, both of which would have failed
at runtime rather than at build:

1. `extensionFor()` could return `""` for a file with no extension (scanner output named
   `scan`), producing a path with no dot — which fails the
   `lead_documents_path_matches_lead_ck` constraint *after* the object had already uploaded.
   Now always returns an extension, falling back to `.bin`.
2. The `assigned_at` trigger/seed interaction above.

**Nothing here has run against a live database, and that gap matters more this phase than
in any previous one.** No Docker on this machine, so: the bucket has never been created, no
file has been uploaded, no signed URL has been minted, and the 25 storage assertions have
never executed. Everything is reasoned against the real policy SQL — but storage policies
have a failure mode the lead tables do not, in that they key off a *string* and can be
defeated by a path shape the author did not imagine. Reasoning is worth less against that
than against a role check.

Two specific things the first live run must confirm, which reasoning cannot settle:

- **That the policies were created at all.** `storage.objects` is owned by
  `supabase_storage_admin`, not `postgres`. Creating a policy requires membership in the
  owning role; `postgres` has it on both local and hosted Supabase, so this is expected to
  work — but "expected to work" on a permissions boundary is exactly the claim worth testing.
  If it fails, the migration errors loudly rather than silently skipping, which is the good
  version of that failure.
- **The `storage.objects` fixture columns in the test file.** The test inserts
  `(bucket_id, name, owner)` directly; that table's shape has varied across Supabase
  versions (`owner` vs `owner_id`). A mismatch fails the suite noisily, which is fine — but
  it means a red suite on first run may be a fixture problem rather than a policy problem,
  and the two need telling apart before anything is concluded.

Run this before trusting any of the above:

```bash
supabase test db
```

---

## What is next

- **The first live run.** This is now clearly the highest-value next step — four phases of
  reasoning are stacked on an unexecuted schema, and the document policies are the ones
  where being wrong is worst.
- **Orphan sweep** for storage objects on lead deletion (Edge Function or `pg_cron`).
- **Realtime** — still on the 30-second notification poll.
- **Capacitor (Phase 4 in `PLAN.md`'s numbering)** — the file picker in `DocumentsTab` uses a
  plain `<input type="file">`, which works in a WebView but will want
  `@capacitor/camera` for "photograph this document" to feel native.
