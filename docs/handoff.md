# Handoff — picking this up on another machine

Written for the case it is about to be used in: continuing on a machine that **has the
Android SDK**, where this one did not.

Read this first. The phase docs explain *why* things are built the way they are; this one is
about getting moving and about what you should not trust yet.

---

## Where it actually stands

| Area | State |
|---|---|
| Database schema, RLS, triggers, RPCs | 14 migrations written, **never executed** |
| pgTAP test suites | 61 assertions written, **never run** |
| Web app (11 routes) | typechecks and builds clean, **never run against data** |
| Android shell | platform added and syncing, **never compiled** |
| Push notifications | client + token store wired; **no Firebase project** |
| Deployment | **none** — `app.myinsurancebro.com` does not exist |

Everything compiles. Nothing has been observed working. Those are different claims and the
gap between them is the main risk in this repo.

---

## First 10 minutes on the new machine

```bash
pnpm install
```

```bash
pnpm cap:sync
```

**Use pnpm, not npm or yarn.** This is not a style preference. `cap sync` generates
`android/capacitor.settings.gradle` with paths into pnpm's store, including version hashes
(`node_modules/.pnpm/@capacitor+android@8.5.0_@capacitor+core@8.5.0/...`). A flat `npm`
layout has no such paths, Gradle fails at settings evaluation, and the error names neither
pnpm nor the real cause. Both generated Gradle files are gitignored precisely so they are
always rebuilt for the layout actually present — which is why `cap:sync` is step two and not
optional.

Then confirm the web side is intact:

```bash
pnpm typecheck && pnpm build
```

Both should pass with **no `.env.local` present**. That has been true at every phase and is
worth re-confirming as a baseline before changing anything.

---

## Android prerequisites

| Need | Note |
|---|---|
| Node ≥ 22 | Capacitor 8 requirement |
| **JDK 21** | Confirmed, not guessed — `android/app/capacitor.build.gradle` is generated with `sourceCompatibility JavaVersion.VERSION_21` |
| Android SDK | Android Studio's wizard installs it |
| `android/local.properties` | must contain `sdk.dir=<path>`; gitignored, written by Studio on first open |

Gradle will not find a JDK on its own. Point at Android Studio's bundled one:

```bash
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
```

Or just:

```bash
pnpm cap:open
```

which presyncs, syncs, then opens Studio.

---

## Building an APK that is worth installing

The shell points at `https://app.myinsurancebro.com`, which is not deployed. An APK built
today reaches the login screen and fails at OTP. To get something testable, in this order:

1. **Stand up the database** (see below). Nothing works without it.
2. **Deploy the web app** — Vercel, per `PLAN.md` §2. Set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` there.
3. Point `PRODUCTION_URL` in `capacitor.config.ts` at the real domain if it differs.
4. `pnpm cap:sync` → build.

To test against a dev server before any of that exists, use the env override — **never** edit
the config file:

```bash
CAP_SERVER_URL=http://10.0.2.2:3000 pnpm cap:sync
```

`10.0.2.2` is the emulator's alias for the host's localhost; use the LAN IP for a physical
device. Re-run `pnpm cap:sync` with no env var before building anything you intend to ship —
the URL bakes in at sync time.

---

## The database, which is still the blocker

No Supabase project exists. Two routes:

**With Docker** (full local stack, seeded, offline):

```bash
supabase start && supabase db reset && supabase test db
```

**Without Docker** (hosted project):

```bash
supabase login && supabase link --project-ref YOUR_REF && supabase db push
```

```bash
supabase test db --linked
```

Do **not** push `seed.sql` to a hosted project — it inserts into `auth.users` directly, which
is a local-only shortcut. Create the first admin through the dashboard instead: insert the
`profiles` row (role `admin`, phone in E.164), then Authentication → Add user with the same
number; the linking trigger joins them.

Strip `[auth.sms.test_otp]` from `supabase/config.toml` before `supabase config push` — it
hardcodes OTP `123456` for three numbers, which is fine locally and a live credential in
production.

**Expect `db push` to fail at least once.** Fourteen migrations, none executed. Specific
things most likely to break, and why:

| Risk | Why |
|---|---|
| Storage policies (`…001200`) | `storage.objects` is owned by `supabase_storage_admin`, not `postgres`. Creating policies needs membership in the owning role. Expected to work; unproven. |
| `documents_rls_test.sql` fixtures | inserts `storage.objects (bucket_id, name, owner)` directly; that table's shape has varied across Supabase versions (`owner` vs `owner_id`). A red suite here may be a fixture problem, not a policy problem — tell them apart before concluding anything. |
| pgTAP plan counts | `plan(36)` and `plan(25)` are hand-counted. An off-by-one fails the suite without any policy being wrong. |

---

## What to distrust

Ranked by how much reasoning is stacked on it versus how much observation:

1. **Storage/document policies** — highest stakes (clients' medical and KYC documents) and
   the only ones keyed off a *string path*, which can be defeated by a path shape I did not
   imagine. 25 assertions target exactly this. Run them first.
2. **The RLS visibility rule** (`PLAN.md` §4) — the product's core guarantee. 36 assertions,
   mostly negative ("broker A sees exactly zero of B's leads").
3. **CSV export** — `lib/csv.ts` mitigates spreadsheet formula injection; never verified by
   opening an actual file in Excel. Also blob downloads are commonly ignored inside an Android
   WebView, so export probably does not work in the wrapped app (flagged in the file).
4. **Session persistence in the WebView** — Supabase writes persistent cookies via
   `@supabase/ssr`; Android's `CookieManager` should retain them across restarts. Single most
   likely native-shell thing to be wrong.
5. **`wa.me` handoff** — §6 Option A is the whole messaging strategy. If a WhatsApp link opens
   *inside* the WebView rather than the WhatsApp app, `allowNavigation` is wrong (it is
   deliberately empty; see `capacitor.config.ts`).

`docs/capacitor-android.md` has the full on-device checklist.

---

## Not built at all

- **Realtime** — notifications still poll every 30s.
- **Policy & renewal tracking** — the `policies` table has full RLS and no UI, so converted
  business cannot be recorded and the premium column on the dashboard's source table will
  read zero until it exists. Probably the largest remaining *functional* hole.
- **Orphaned Storage objects** — deleting a lead cascades its document metadata but leaves the
  files. Needs an Edge Function or `pg_cron` sweep; the reasoning is in the Phase 4 doc.
- **Push sending** — Firebase project, `google-services.json`, the Google Services Gradle
  plugin, and an Edge Function to actually send.
- **iOS** — never added.

---

## House rules that matter to a new contributor

From `CLAUDE.md`, the two that are load-bearing rather than stylistic:

- **Visibility is enforced in Postgres, not the UI.** Any new table holding client data gets
  RLS and explicit policies in the same migration that creates it. Hiding a row in React is
  not security.
- **An RLS-blocked write returns zero rows, not an error.** Every mutation hook checks the
  returned row and throws when it is empty. Skipping that check shows a success toast for a
  write the database refused — the most dangerous failure mode in this codebase, and the
  reason the pattern is repeated in every hook.
