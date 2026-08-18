# Handoff — picking this up on another machine

Written for the case it is about to be used in: continuing on a machine that **has the
Android SDK**, where this one did not.

Read this first. The phase docs explain *why* things are built the way they are; this one is
about getting moving and about what you should not trust yet.

---

## Where it actually stands

| Area | State |
|---|---|
| Database schema, RLS, triggers, RPCs | 14 migrations, **applied clean** on a local Docker stack |
| pgTAP test suites | 61 assertions, **all passing** (36 RLS/metrics + 25 documents) |
| Phone OTP login | **verified end to end** — request → verify → session issued → profile linked |
| Web app (11 routes) | typechecks and builds clean, **still never run against data** |
| Android shell | platform added and syncing, **never compiled** |
| Push notifications | client + token store wired; **no Firebase project** |
| Deployment | **none** — `app.myinsurancebro.com` does not exist |

The first two rows changed on 2026-08-18. Until then this document said *"everything
compiles, nothing has been observed working"* — the schema had never executed and the 61
assertions had never run. Both have now happened, on a local stack, and **two real defects
surfaced immediately** (recorded below). That is the argument for running things rather than
reasoning about them, made at this repo's own expense.

The gap has not closed, it has moved. The database half is now observed. The application
half — 11 routes, every TanStack Query hook, the whole Android shell — is exactly as
unobserved as it was before. Passing pgTAP proves the *policies* hold; it says nothing about
whether the app's queries use them correctly.

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

## The database — stood up locally, still unproven when hosted

No *hosted* Supabase project exists. A local stack has been run end to end, so the migrations
and the suites now have observation behind them rather than only review.

### Local stack (Docker) — proven

Full stack, seeded, runs offline once the images are pulled.

```bash
supabase start
```

```bash
supabase test db
```

`supabase start` applies all 14 migrations and then runs `seed.sql`. On a first run it pulls
several GB of images; afterwards the stack is fully offline.

### The four defects that surfaced on first execution

All four were invisible to review and to `pnpm typecheck`. All four are fixed; each is worth
understanding, because each was a *class* of mistake rather than a typo. Three of them
independently made login impossible — which is to say the product had three separate
show-stoppers in a codebase that compiled cleanly.

**1. The profile guard blocked the auth linking trigger.**
`app_private.guard_profile_columns` refuses any change to `auth_uid` unless
`app_private.is_admin()`. But `link_auth_user_to_profile` runs `update public.profiles set
auth_uid = ...` on a connection with **no JWT**, so `auth.uid()` is null, `is_admin()` is
false, and the guard raised `42501` against the very trigger it was never meant to police.

The visible symptom was a failed seed. The real blast radius was production login: GoTrue
inserts into `auth.users` with no app JWT, so **every broker's first OTP login would have
failed**, and both pgTAP suites die at fixture setup for the same reason. One bug, three
sites, and the only one you would ever have noticed in review is the least important.

The fix exempts the no-JWT case in both column guards — safe because `anon` holds no UPDATE
grant on `profiles` or `leads`, so a null `auth.uid()` cannot originate from a client. The
same exemption went onto `guard_lead_columns`, which had no reachable failure today but is
structurally identical and would have trapped the next system-context write.

**2. A test asserted the wrong security mechanism.**
`rls_and_metrics_test.sql` asserted that `anon` sees zero rows in `public.leads` — i.e. that
RLS filters them out. It does not, because `anon` has **no grant at all** on that table, so
Postgres refuses at the privilege layer before RLS is ever consulted.

The database is *stronger* than the assertion assumed. The assertion now expects `42501`.
Recorded here because the tempting fix was the catastrophic one: making the original pass
required granting `anon` SELECT — opening a public read surface in order to test that no
public read surface exists.

**3. `[auth.sms] enable_signup = false` disabled phone login entirely.**
The key is misleadingly named. The CLI maps it to `GOTRUE_EXTERNAL_PHONE_ENABLED`, so it
controls whether phone auth *exists*, not whether strangers may sign up by SMS. With it
false, GoTrue rejected every `/otp` request with `phone_provider_disabled` — surfaced in the
UI as **"Unsupported phone provider"** — before even looking at the number.

Phone + OTP is the only login route for brokers, so the single setting that read as the
cautious choice made the product unusable. No public signup is enforced three other ways
(`[auth] enable_signup = false` → `GOTRUE_DISABLE_SIGNUP=true`, `shouldCreateUser: false` in
`lib/auth/useAuth.tsx`, and the linking trigger leaving unknown numbers profile-less), so
nothing was lost by setting it true. `[auth.sms.twilio]` also had to be enabled with
placeholder credentials so a provider exists; `[auth.sms.test_otp]` intercepts sending for
the three seeded numbers, so no Twilio call is ever made.

**4. `seed.sql` produced `auth.users` rows GoTrue cannot read.**
With phone auth finally on, `/otp` returned `500 Database error finding user`.
`confirmation_token`, `recovery_token`, `email_change` and `email_change_token_new` are
declared without defaults, so inserting into `auth.users` directly left them NULL — and
GoTrue scans them into non-nullable Go strings.

What makes this one nasty is that sibling columns (`phone_change`, `reauthentication_token`,
`email_change_token_current`) *do* carry defaults, so half the columns fix themselves and the
row looks healthy in Studio. The seed now writes `''` explicitly. Real users never hit this,
because GoTrue writes those columns itself; only the local-only shortcut of seeding
`auth.users` by hand can produce it.

### Seeded and unseeded are two different databases

`profiles.phone` is `unique`, and `seed.sql` uses `+919000000001/2/3` — the same numbers
`rls_and_metrics_test.sql` inserts. That suite also asserts absolute counts ("admin sees
every lead" = 3) which six seeded leads break regardless of the collision. So:

```bash
supabase db reset --no-seed
```

before `supabase test db`, and:

```bash
supabase db reset
```

to get demo data back for using the app. `documents_rls_test.sql` sidesteps this by using a
distinct `+9191…` range; the other suite predates `seed.sql`. Left as-is deliberately —
rescoping those counts to tolerate seed data would weaken what they prove.

### Hosted project (no Docker) — still unproven

Nothing below this line has been executed against a real Supabase project.

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

**Expect `db push` to fail at least once anyway.** The local run clears three risks this
document previously flagged, but a hosted project is a different privilege environment:

| Previously flagged | Outcome locally |
|---|---|
| Storage policies (`…001200`) | **Passed.** `storage.objects` is owned by `supabase_storage_admin`, and creating policies on it needs membership in the owning role — which `postgres` has locally. **Still the most likely hosted failure**, since that membership is what may differ. |
| `documents_rls_test.sql` fixtures | **Passed.** The `storage.objects (bucket_id, name, owner)` shape matched; the `owner` vs `owner_id` drift did not bite on this version. |
| pgTAP plan counts | **Correct.** `plan(36)` + `plan(25)` = the 61 assertions actually run. The hand-count was right. |

The lesson is not that these were false alarms — it is that the two defects which did bite
were on neither list. Ranking risk by how much reasoning is stacked on something is useful;
it is not a substitute for execution.

---

## Running the application, step by step

This is the path that has actually been walked, on Windows 11 Home. Traps noted where they
were hit rather than where they were expected.

### 0. Toolchain

You do **not** install Postgres. Supabase's CLI runs Postgres, GoTrue, PostgREST, Storage,
Kong and Studio as Docker containers; that is also what guarantees the local Postgres matches
the hosted one (`config.toml` pins `major_version = 17`), without which testing RLS locally
would prove nothing about production.

| Need | Install | Trap |
|---|---|---|
| Node ≥ 22 | nodejs.org | — |
| pnpm 9.15.4 | `npm install -g pnpm@9.15.4` | `corepack enable pnpm` writes into `C:\Program Files\nodejs` and fails with `EPERM` unless elevated. npm's prefix is user-writable and already on PATH, so this route needs no admin. |
| Docker Desktop | `winget install Docker.DockerDesktop` | Needs the **WSL2** backend — Hyper-V is not available on Windows Home. |
| Supabase CLI | Scoop: `scoop bucket add supabase …` then `scoop install supabase` | `npm i -g supabase` is unsupported. The Scoop **installer refuses to run elevated** — use a normal shell, not the admin one you opened for WSL. |

If `wsl --status` reports *"virtualization is not enabled"*, run `wsl --install
--no-distribution` **as Administrator** and reboot. On the machine this was written on, CPU
virtualization was already enabled in firmware — what was missing was the Windows *Virtual
Machine Platform* component. Check `Get-CimInstance Win32_Processor | Select
VirtualizationFirmwareEnabled` before touching BIOS; if it is already `True`, BIOS is not
your problem.

### 1. Dependencies

```bash
pnpm install
```

### 2. Start Docker Desktop

Launch it from the Start menu and wait for **"Engine running."** There is no background
service — every `supabase` command fails with `failed to connect to the docker API at
npipe:////./pipe/docker_engine` until the desktop app is actually up.

### 3. Bring up the stack

```bash
supabase start
```

Applies all 14 migrations, then seeds. Copy the **`ANON_KEY`** it prints. Ignore
`SERVICE_ROLE_KEY` entirely — it bypasses every policy in `supabase/migrations` and has no
use in this codebase.

### 4. Point the app at it

Create `.env.local` (gitignored; never committed — see `CLAUDE.md`):

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the ANON_KEY printed above>
```

### 5. Run it

```bash
pnpm dev
```

### 6. Log in

`http://localhost:3000`, OTP **`123456`** for all three seeded users — the codes are fixed in
`config.toml` under `[auth.sms.test_otp]` and exist only locally.

| Phone | Who |
|---|---|
| `+919000000001` | Asha Sen — admin |
| `+919000000002` | Ankit Roy — broker A |
| `+919000000003` | Priya Das — broker B |

### 7. Verify the thing the product is actually for

Log in as broker A, note the leads. Log out, log in as broker B. **A must not see any of B's
leads.** This is the one manual check worth doing every time, because it is the guarantee the
whole schema exists to provide — and unlike the pgTAP suites, it exercises the path the app
really takes.

Studio at `http://127.0.0.1:54323` browses tables directly, which is why `psql` is not needed.

### Useful afterwards

```bash
supabase stop
```

```bash
supabase status
```

---

## What to distrust

Ranked by how much reasoning is stacked on it versus how much observation. The top two items
moved **down** on 2026-08-18, because they now have observation behind them:

1. **The app's own queries against real data** — now the least-observed thing in the repo.
   Eleven routes and eight TanStack Query hooks have never returned a row. Passing pgTAP
   proves the policies are correct; it does not prove a hook selects the right columns,
   handles an empty result, or checks the returned row on a write. Start here.
2. **CSV export** — `lib/csv.ts` mitigates spreadsheet formula injection; never verified by
   opening an actual file in Excel. Also blob downloads are commonly ignored inside an Android
   WebView, so export probably does not work in the wrapped app (flagged in the file).
3. **Session persistence in the WebView** — Supabase writes persistent cookies via
   `@supabase/ssr`; Android's `CookieManager` should retain them across restarts. Single most
   likely native-shell thing to be wrong.
4. **`wa.me` handoff** — §6 Option A is the whole messaging strategy. If a WhatsApp link opens
   *inside* the WebView rather than the WhatsApp app, `allowNavigation` is wrong (it is
   deliberately empty; see `capacitor.config.ts`).
5. **Storage/document policies** — was #1. 25 assertions now pass, including the hostile and
   malformed path cases, which is the specific thing that worried me: these are the only
   policies keyed off a *string path*. Demoted, not cleared — no file has actually been
   uploaded or downloaded through the app, so the *policies* are proven and the *round trip*
   is not.
6. **The RLS visibility rule** (`PLAN.md` §4) — was #2. 36 assertions pass, mostly negative
   ("broker A sees exactly zero of B's leads"), across both visibility modes and the
   deactivated-broker case. The strongest-evidenced thing in the repo. Still worth the manual
   two-broker check in step 7 above, which tests the app's path rather than the suite's.

`docs/capacitor-android.md` has the full on-device checklist.

---

## Not built at all

- **Realtime** — notifications still poll every 30s.
- **Policy & renewal tracking** — the `policies` table has full RLS and no UI, so converted
  business cannot be recorded and the premium column on the dashboard's source table will
  read zero until it exists. Probably the largest remaining *functional* hole.
- **Orphaned Storage objects** — deleting a lead cascades its document metadata but leaves the
  files. Needs an Edge Function or `pg_cron` sweep; the reasoning is in the Phase 4 doc.
  Note before starting it: `service_role` currently holds **no DML on `public.leads`** (only
  `REFERENCES`, `TRIGGER`, `TRUNCATE` — observed on the local stack, where `authenticated`
  has the full set). An Edge Function runs as `service_role`, so it will need explicit grants
  written into a migration first. Grant the narrowest set that function needs, not `all`.
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
