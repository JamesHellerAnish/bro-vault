# MyInsuranceBro — Client & Lead Management Platform
### Product + Technical Plan (v1, draft for approval)

One codebase → responsive web app (desktop + mobile browser) → wrapped with Capacitor into an Android app. Same login, same data, same features everywhere.

---

## 1. Users & roles

| Role | Who | Can do |
|---|---|---|
| **Admin** (Chief Advisor) | You | Everything: see all leads, all brokers' dashboards, org-wide analytics, create/deactivate broker accounts, reassign leads, edit templates, flip the global visibility switch |
| **Broker** | Enrolled team members | Own their assigned leads fully; see other leads only if the visibility switch is ON (and then read-only); see only their own dashboard numbers |
| *(optional later)* **Team Lead** | Senior broker | Own leads + see their sub-team's leads and stats |

**No public signup.** Admin pre-registers a broker's phone number → the broker logs in with **phone + OTP** (no password to forget or share). This is the `fe-gmq` pattern and it's the right one for a field sales team in India. Deactivating a broker keeps their history intact and pushes their open leads to a reassignment queue.

---

## 2. Recommended stack

*Revised after analysing `fe-gmq` (the GetMyQuotation vendor app) — see §13. Where that codebase has already solved a problem, we copy it rather than re-decide it.*

| Layer | Choice | Why |
|---|---|---|
| UI | **Next.js 15 App Router + React 19 + TypeScript** | Same stack as `fe-gmq`, already proven end-to-end with Capacitor. SSR also gives a public marketing/landing site real SEO — a Vite SPA can't. |
| Styling | Tailwind + shadcn/ui + a ported `broker-theme.css` token layer | `fe-gmq`'s `partner-theme.css` is the minimalist look you like; it ports over as tokens (§13) |
| State/data | TanStack Query | Caching, optimistic updates, offline-tolerant reads. (`fe-gmq` uses raw `useState` + `useEffect`; Query is the one upgrade worth making.) |
| Forms | react-hook-form + zod | Already the `fe-gmq` pattern |
| Backend | **Supabase** (Postgres, Auth, Row Level Security, Storage, Edge Functions, Realtime) — see the Django alternative below | The visibility rules in requirement #4 are literally a database-row-security problem — Postgres RLS solves it at the data layer, so a broker *cannot* fetch another broker's lead even by hitting the API directly. No servers to run. |
| Mobile shell | **Capacitor 8 in live-URL mode** | Exactly what `fe-gmq` does: the native shell loads the deployed URL in a WebView. No static export, SSR works, and web fixes are live in the app instantly without a Play Store resubmission. |
| Charts | Recharts | Already in `fe-gmq` |
| Web hosting | Vercel | Free tier, instant deploys, custom domain (e.g. `app.myinsurancebro.com`) |
| Push | Firebase Cloud Messaging via Capacitor | Follow-up reminders, new-lead-assigned alerts (`fe-gmq` skipped push; we need it) |

**Backend — the real choice is Supabase vs. Django REST.** `fe-gmq` is a thin client over a Django/DRF backend (`be.getmyquotation.com`). If the same backend developers work on this, Django is a legitimate option with patterns already proven. The trade-off:

- **Supabase (recommended):** the visibility switch is one RLS policy, enforced by the database on every query. Nothing to remember per endpoint. Auth, storage, and realtime included. Fastest to a working product.
- **Django + DRF:** more control, and reuses existing team knowledge — but requirement #4 becomes manual queryset filtering in every view. Miss one endpoint and a broker can read leads they shouldn't. That's a discipline problem where Supabase gives a structural guarantee, and for client PII that difference matters.

**Why not a native Android app?** You need a web version too (requirement #1). Building both natively doubles the work. Capacitor gives one codebase, a near-native feel, Play Store presence, push notifications, and direct WhatsApp/dialer intents — and `fe-gmq` already proves the approach ships.

### Is Next.js enough as the backend? Yes — no separate server needed.

Next.js Route Handlers (`app/api/*/route.ts`) run as serverless functions with access to secrets and the database. That *is* a backend. `fe-gmq` has Django because that product needs RAG, a catalog engine and AI question generation — genuinely Python-shaped work. Nothing here is.

| Work | Runs where | Why |
|---|---|---|
| Lead reads/writes, filters, assignment | Supabase client SDK, **direct from browser/app** | RLS enforces visibility in the database; proxying through Next.js adds a hop and buys nothing |
| Dashboard aggregates | Postgres RPC (`SECURITY DEFINER`) | The role check belongs next to the data |
| Email + WhatsApp Cloud API sends | Next.js Route Handler | Holds API keys — must never reach the client |
| WhatsApp inbound webhook (Phase 5) | Next.js Route Handler | Meta only needs a public HTTPS endpoint |
| CSV import / export | Route Handler, chunked | See the timeout note below |
| Follow-up reminders, renewal alerts, unattended-lead nudges | **Supabase `pg_cron`** (or Vercel Cron) | ← the one thing Next.js can't do alone |

**Two real limits, both with clean answers:**

1. **No scheduler.** A serverless function only runs when something calls it, but this app needs timed work (9am follow-up reminders, overdue alerts, renewal notices). Use Supabase `pg_cron` calling an Edge Function — it lives in the database we already have, with no cron-count tier limit. Vercel Cron is the alternative (free tier is roughly daily; paid gives minute granularity).
2. **Execution time caps.** Serverless functions are capped at tens of seconds on free tiers, a few minutes on paid. Fine for everything here, provided bulk work (importing 5,000 leads from a spreadsheet) is chunked into batches rather than one long request. A code pattern, not an architecture change.

**What would force a separate always-on server:** background job queues with retries and rate limiting at volume; a persistent process holding long-lived connections — which is exactly what WhatsApp Web automation (§6 Option C) needs, and a further reason to avoid it; or switching to Django, where the backend *is* the separate service. None of these appear in Phases 0–4.

---

## 3. Data model

```
profiles          id, auth_uid, full_name, email, phone, whatsapp_number,
                  role (admin|broker), is_active, avatar_url, joined_at

leads             id, full_name, phone, whatsapp_number, email,
                  age | date_of_birth, gender, city, state, pincode,
                  occupation, annual_income_band,
                  insurance_types[]  -- health, term_life, motor, travel, ...
                  source             -- referral, facebook_ad, website, walk_in,
                                        cold_call, IndiaMART
                  status             -- pipeline stage (below)
                  temperature        -- hot | warm | cold
                  traits[]           -- the tags (below)
                  description        -- free text: needs, wants, situation
                  budget_expectation, existing_policies,
                  preferred_language, preferred_contact_time,
                  assigned_to  -> profiles.id      (the accountable broker)
                  created_by   -> profiles.id
                  is_private   boolean             (per-lead override of visibility)
                  next_follow_up_at, created_at, first_contacted_at,
                  converted_at, lost_at, lost_reason

lead_activities   id, lead_id, actor_id, type (call|whatsapp|email|meeting|note|
                  status_change|assignment), direction (in|out), channel_ref,
                  template_id, body, outcome, occurred_at
                  -- the single timeline shown on the lead page

lead_status_history  id, lead_id, from_status, to_status, changed_by, changed_at
                  -- powers conversion-time and stage-duration metrics

policies          id, lead_id, insurer, product_name, policy_number, sum_assured,
                  premium, commission_pct, issue_date, renewal_date
                  -- converted business; later drives renewal reminders

templates         id, channel (whatsapp|email), name, category, subject, body,
                  variables[], language, is_active, created_by

org_settings      lead_visibility ('all' | 'assigned_only'),
                  allow_cross_broker_edit (bool), business_hours, timezone

notifications     id, user_id, type, payload, read_at
audit_log         id, actor_id, entity, entity_id, action, diff, at
```

### Pipeline statuses (drive the funnel chart)
`New` → `Contacted` → `Interested` → `Quote Shared` → `Negotiation / Docs Pending` → **`Converted`**

Terminal off-ramps: `Not Reachable`, `Lost`, `Do Not Contact`

### Traits — the "factors" from requirement #5 (multi-select chips)

- **Behavioural:** Somewhat interested · Highly interested · Will call back · Asked to call later · Price sensitive · Comparing with other brokers · Needs family discussion · Just enquiring · Ready to buy
- **Situational:** Documents pending · Medical test required · Existing policy expiring soon · Renewal case · Claim support needed · NRI · Senior citizen · Pre-existing condition
- **Operational:** Prefers WhatsApp only · Prefers call · Language: Hindi / Bengali / English · Referral · Wrong number · Do not disturb

Traits live in a lookup table, so **you can add or rename them from the admin panel** without a code change. They render as colour-coded chips on the lead card and are filterable in the list.

---

## 4. Lead visibility (requirement #4) — how the switch works

A single org setting, `lead_visibility`, flipped by Admin in Settings:

- **`all` (open mode):** every broker sees every lead in the list, but non-owners get a **read-only** view — no editing, no messaging, no status change. The assigned broker's name and photo sit at the top of every lead card, so accountability stays visible.
- **`assigned_only` (closed mode):** a broker's list contains only leads where `assigned_to = me`. Admin still sees everything.

Enforced in Postgres RLS, e.g.:

```sql
create policy leads_read on leads for select using (
  is_admin(auth.uid())
  or assigned_to = current_profile_id()
  or ((select lead_visibility from org_settings) = 'all' and not is_private)
);

create policy leads_write on leads for update using (
  is_admin(auth.uid()) or assigned_to = current_profile_id()
);
```

Because this lives in the database, hiding a lead in the UI and hiding it from the API are the same act — a broker cannot pull hidden data with a hand-crafted request. `is_private` lets you hide one sensitive lead (a VIP or corporate case) even while the org is in open mode.

---

## 5. Lead detail screen (mobile-first)

```
┌───────────────────────────────┐
│ ← Ramesh Sharma          ⋮    │
│ 🔥 Hot · Health Insurance     │
│ Assigned: Ankit    (Admin: ⇄) │
├───────────────────────────────┤
│ [📞 Call] [💬 WhatsApp] [✉ Mail]│  ← sticky action bar
├───────────────────────────────┤
│ Traits: Will call back ×      │
│         Price sensitive ×   + │
├───────────────────────────────┤
│ Details  │  Timeline  │  Docs │
│                               │
│ Phone      +91 98xxx xxxxx 📋 │
│ WhatsApp   +91 98xxx xxxxx    │
│ Age 42 · Male · Kolkata       │
│ Source: Facebook Ad           │
│ Budget: ₹25–30k / year        │
│                               │
│ Description                   │
│ "Family of 4, wants ₹10L      │
│  floater, worried about       │
│  father's diabetes exclusion" │
├───────────────────────────────┤
│ Next follow-up: Tomorrow 11am │
│ Status: Quote Shared        ▼ │
└───────────────────────────────┘
```

The Timeline tab shows every call / WhatsApp / email / note in reverse-chronological order with who did it. Every outbound message logs itself automatically.

---

## 6. WhatsApp strategy (requirement #7)

This is the part with real trade-offs, so here are the three options honestly:

### Option A — Click-to-chat deep links *(Phase 2 — start here)*

The app opens WhatsApp on the broker's own phone with the number and a **pre-filled template message** already typed; the broker taps send.

- URL: `https://wa.me/91XXXXXXXXXX?text=<encoded template>` — works on web and Android; inside the Capacitor app it opens the installed WhatsApp directly.
- ✅ Zero cost, zero infrastructure, zero ban risk, works on day one, and the lead receives it from a real person's number.
- ❌ The broker must tap send; we log "template X sent at T" optimistically, and replies aren't captured automatically. Mitigation: a one-tap "log outcome" prompt when the broker returns to the app.
- **Template library** in the app: greeting, quote follow-up, document reminder, renewal reminder, festival wish — with `{{name}}`, `{{policy}}`, `{{premium}}` merge fields in English / Hindi / Bengali. Admin owns the library; brokers stay on-script.

### Option B — WhatsApp Cloud API, official Meta *(Phase 5 — the true multi-user solution)*

One verified business number (the MyInsuranceBro main line) plus a **shared team inbox inside the app**, where each conversation is assigned to the accountable broker.

- ✅ Real multi-agent handling, automatic inbound capture, delivery/read receipts, automation (auto-reply, drip follow-ups, renewal reminders), complete audit trail, no ban risk.
- ❌ Needs Meta Business verification and a phone number dedicated to the API — that number can no longer be used in the regular WhatsApp app. Business-initiated messages must use **pre-approved templates** and are billed per message (India: utility messages cost a fraction of a rupee, marketing several times more — verify Meta's current rate card at build time). Replies inside the 24-hour customer service window are free.
- Implementation: Meta webhook → Supabase Edge Function → `lead_activities` + Realtime push to the assigned broker.

### Option C — WhatsApp Web automation (whatsapp-web.js / Baileys) — **not recommended**

Runs a headless browser session per broker on a server, paired by QR, sending from personal numbers.

- ✅ Free messages, personal numbers, full inbound capture.
- ❌ Unofficial and against WhatsApp's terms — **numbers get banned**, especially at outreach volume. Needs a persistent browser session per broker (RAM-hungry), breaks whenever WhatsApp updates, and sessions drop and need re-scanning. Losing a broker's personal WhatsApp number is a serious business risk for a brokerage.

**Recommendation:** ship **A** now — it covers ~90% of daily use immediately — and plan **B** for the shared business number once volume justifies the setup. Keep **C** off the table.

### Email

- Phase 2: `mailto:` deep link with subject and body pre-filled from a template (same pattern as A).
- Phase 5: real transactional sending via **Resend** or **Brevo** (or the firm's Google Workspace SMTP) from an Edge Function — delivery/open tracking, attachments (quotes, brochures, policy PDFs), automatic timeline logging. Same merge-field engine as WhatsApp templates.

---

## 7. Dashboard (requirement #6)

**Broker dashboard — own data only:**

- Leads received / contacted / converted — this week, this month, custom range
- Conversion rate % and trend against the previous period
- **Average conversion time** (created → converted) and **average time to first contact**
- Pipeline funnel by stage; leads aging without contact
- Follow-ups due today / overdue — the daily to-do list
- Activity count (calls, WhatsApps, emails): effort against outcome

**Admin dashboard — org-wide, invisible to brokers:**

- Everything above, aggregated, plus a **per-broker leaderboard**: leads handled, conversion %, average conversion time, average response time, activity volume
- Source performance — which channel converts best; cost-per-conversion if you feed in ad spend
- Insurance-type mix, premium and commission totals from `policies`
- **Unattended leads** alert: assigned more than 24h ago with zero activity
- Reassignment tool and CSV/Excel export

Metrics come from `SECURITY DEFINER` Postgres functions that check the caller's role before returning anything — a broker calling the org-metrics function gets back only their own slice, no matter what the client asks for.

---

## 8. Screen map

```
Auth            Login · Forgot password · First-time password set
Main tabs       Dashboard · Leads · Follow-ups · Team* · Profile
Leads           List (search; filter by status / trait / type / city / broker; sort)
                Lead detail (Details / Timeline / Documents)
                Add lead · Quick-add (name + phone only)
                Bulk CSV import*
Follow-ups      Today · Overdue · Upcoming (agenda view)
Team*           Broker list, invite broker, per-broker stats, reassign leads
Settings*       Visibility switch, traits & statuses, templates, sources, org profile
Profile         My info, notification prefs, change password, logout
                                                          (* = admin only)
```

**Mobile:** bottom tab bar, thumb-reachable FAB for "Add lead", swipe actions on list rows (call / WhatsApp / snooze follow-up), pull-to-refresh.
**Desktop:** identical routes in a two-pane layout (list + detail side by side) with a left sidebar instead of bottom tabs.

---

## 9. Delivery phases

Estimates below are **after** the `fe-gmq` reuse in §13 — the UI kit, theme layer, app shell and Capacitor setup come across rather than being built.

| Phase | Scope | Estimate | Was, without reuse |
|---|---|---|---|
| **0 — Foundations** | Repo, Next.js + Tailwind, port `components/ui` + theme, Supabase project, schema + RLS, phone-OTP auth, roles, app shell, deployed web URL | 3–4 days | 4–6 |
| **1 — Lead core** | Lead CRUD, list with filters/search/infinite scroll, detail screen, traits, description, assignment, activity timeline, visibility switch | 6–8 days | 7–10 |
| **2 — Communication** | WhatsApp deep links, template library with merge fields, `mailto` email, activity logging, follow-up scheduling | 4–6 days | 4–6 |
| **3 — Dashboards** | Broker and admin metric functions, charts, leaderboard, exports | 5–7 days | 5–7 |
| **4 — Android app** | Capacitor live-URL wrap, icons and splash, push notifications, Play Store internal-testing release | **1–2 days** | 4–6 |
| **5 — Upgrades** | WhatsApp Cloud API shared inbox · real email sending with tracking · policy and renewal tracking · document storage · offline mode · Excel import | 3–5 weeks | — |

Phases 0–4 produce a fully usable product for the team — roughly **4–5 weeks** of focused work (down from 5–7 before the reuse).

---

## 10. Running cost (rough, per month)

- Supabase — free tier to start, **$25** Pro once you outgrow it (needed for daily backups, worth it as soon as real client data lands)
- Vercel / Netlify hosting — free
- Domain — about ₹1,000/year
- Google Play developer account — **$25 one-time**
- Email (Resend / Brevo) — free up to roughly 3,000 emails/month
- WhatsApp Cloud API (Phase 5 only) — per-message, pay-as-you-go to Meta

Effectively **₹0–2,500/month** until Phase 5.

---

## 11. Security & compliance notes

- RLS on every table; the client never holds a service-role key. All privileged work runs in Edge Functions.
- Audit log for lead reassignment, status changes, exports, and visibility-switch flips.
- Client PII (name, phone, health hints in the description field) is sensitive under India's **DPDP Act 2023** — plan for consent capture at lead intake, a stated retention period, and no data leaving the app without an admin action.
- WhatsApp marketing templates require recipient opt-in; store the consent flag on the lead.
- Strong passwords plus optional 2FA for admin; biometric app-unlock in a later phase.

---

## 12. Decisions needed before building

1. **Team size now, and in 12 months?** Drives the Supabase tier and whether the Team Lead role is worth adding.
2. **Where do leads come from today** — Facebook/Google ads, website form, IndiaMART, referrals, spreadsheets? Any that should auto-create leads via webhook?
3. **Do you already have a Meta Business account or WhatsApp Business API number?** If yes, Phase 5 can move earlier.
4. **Existing data** — is there a spreadsheet of current leads to import on day one?
5. **Policy, commission and renewal tracking in v1**, or leads only? It's the natural next module, and knowing now slightly changes the schema.
6. **Languages** for the UI and message templates — English only, or Hindi/Bengali too?
7. **Backend: Supabase or Django/DRF?** (§2) — Supabase is the recommendation; Django wins only if the `be-gmq` developers are building this too.
8. **Brand colour** for the theme tokens — `fe-gmq` uses red `#E53935`. Insurance usually reads better in deep blue or green (trust/safety). One variable, so it's easy either way.

---

## 13. What we reuse from `fe-gmq` (GetMyQuotation vendor app)

Analysed at `C:\Users\mondaani\Downloads\fe-gmq-main\fe-gmq-main`. It's a Next.js 15 + React 19 + Tailwind app whose `/partner` section is a vendor-facing lead/quote/chat tool wrapped in Capacitor — structurally the same product shape as this one (a mobile-first, role-scoped lead workspace). Most of the hard, boring decisions are already made and battle-tested there.

### Port almost as-is

| From `fe-gmq` | Becomes | Value |
|---|---|---|
| `app/partner/partner-theme.css` (418 lines) | `broker-theme.css` | **The biggest win.** A complete minimalist design system: tokens (surface, border, brand, text, 4 shadow levels, radii), plus `p-card`, `p-badge`, `p-btn`, `p-chip`, `p-stat-card`, `p-tabs`, `p-skeleton` shimmer, `p-progress-bar`, chat bubbles, safe-area helpers and 7 keyframe animations. Change `--p-brand` and it's a different product. |
| `components/ui/*` (~70 shadcn components) | Same folder | Buttons through data tables, already styled and version-pinned. Saves days. |
| `PartnerAppShell` + `PartnerBottomNav` + `PartnerTopBar` | `BrokerAppShell` etc. | 5-tab bottom nav with unread badge, sticky blurred top bar, and the *hide the nav on focused detail routes* rule — the thing that makes it feel like an app rather than a website. |
| `PartnerAuthGate` + `PartnerSplash` + `PartnerLoginScreen` | Broker equivalents | Phone-OTP login, splash-while-checking, and a wrong-role notice screen. |
| `lib/auth/tokenStorage.ts` | Same | `@capacitor/preferences` wrapper that works natively *and* in a plain browser with no platform branching. Carries a hard-won warning: the plugin is a Proxy that treats `.then` as a method call, so the dynamic import must stay inlined per function. Copy the comment with the code. |
| `lib/utils/status.ts` | Lead status + trait maps | The `STATUS → label` / `STATUS → colour class` map pattern is exactly how we render pipeline stages and trait chips. |
| `components/shared/WhatsAppButton.tsx` | Broker WhatsApp action | Already the `https://wa.me/<number>?text=<encoded>` deep-link pattern §6 Option A recommends — **this confirms the approach is already working in your other product.** |
| `hooks/useAuth.tsx` | Same | Includes a subtle fix worth inheriting: gate the splash on `initialCheckComplete`, not `loading`, or every OTP request unmounts the login form and resets it. Also a staleness counter so a slow initial auth check can't overwrite a fresh login. |
| `docs/vendor-app-capacitor.md` | Build runbook | Documents every Android gotcha already paid for (below). |

### Capacitor: live-URL mode changes Phase 4 from a week to a day

`fe-gmq`'s `capacitor.config.ts` sets `server.url` to the deployed `/partner` URL instead of bundling a static export. The native app is a scoped WebView over the live site — so SSR, dynamic routes and image optimisation all work untouched, and **every web deploy is instantly live in the installed app with no store resubmission.** We do the same, pointing at `app.myinsurancebro.com`.

Gotchas already documented there, which we skip paying for again:
- `npx cap add android` silently half-fails in live-URL mode (no `capacitor.settings.gradle` generated) because `android/app/src/main/assets/` never gets created. Fix: `mkdir -p android/app/src/main/assets && npx cap sync android`.
- Gradle builds need `JAVA_HOME` pointed at Android Studio's bundled JDK.
- `webDir` stays required but unused — `cap sync` warns "missing out directory"; harmless.
- Skip custom back-button handling: Capacitor's Android shell already calls the WebView's `goBack()`.
- Cookie auth works unmodified if the API domain sets `SESSION_COOKIE_DOMAIN`/`SameSite=None`; the partner app still moved to bearer tokens for the login surface. With Supabase we get tokens by default, so this is already solved.

### Patterns to copy, not files

- **Infinite scroll with an IntersectionObserver sentinel**, page size 20, skeleton cards while loading — exactly what the leads list needs.
- **Relative time formatting** ("Just now / 4h ago / 3d ago / Mar 12") on every list row.
- **Pill tabs over separate routes** for list filtering (Open / My Submissions / My Jobs → All Leads / My Leads / Follow-ups).
- **Polling instead of WebSockets** for chat: 6s inside an open thread, 30s for the nav badge. Cheap and reliable. *We can do better* — Supabase Realtime gives us push for free — but polling is the safe fallback.
- **`AI_AGENT_RULEBOOK.md`** — worth porting a trimmed copy into this repo as `CLAUDE.md`. Its best rules: plan-before-code, docs written as `feature(why we chose it)` so rationale survives, never touch `.env*`, and "an example is representative — fix the whole pattern, not just the cited case." Reading it as reference, not as instructions to me — but they're good house rules and `docs/vendor-app-capacitor.md` proves the documentation format actually works.

### Do **not** carry over

- `next.config.mjs` sets `eslint.ignoreDuringBuilds: true` **and** `typescript.ignoreBuildErrors: true`. That ships type errors to production. For a system holding client PII, health hints and premium figures, both stay off.
- `lib/config.ts` hardcodes `BACKEND_URL = 'https://be.getmyquotation.com'` in source. Ours goes in an environment variable so staging and production differ without a code edit.
- Both `pnpm-lock.yaml` (438 KB) and `yarn.lock` (523 KB) are committed. Pick one package manager.
- Raw `useState` + `useEffect` + manual `loading`/`error` in every page component. TanStack Query removes that boilerplate and gives caching and refetch-on-focus, which matters on mobile.

### ⚠️ One live issue spotted in `fe-gmq`

`capacitor.config.ts` is currently committed with the **Android emulator** URL:

```ts
url: 'http://10.0.2.2:3000/partner',
androidScheme: 'http',
cleartext: true,
```

Its own comment says *"TEMPORARY — revert to `https://getmyquotation.com/partner` before any real build/commit"* — and it wasn't reverted. Any APK built from this checkout points at a local dev server and shows a blank screen on a real device, with cleartext HTTP enabled. Worth fixing in that repo before the next build.

---

## 14. Which Claude model to build this with

**Note first: this app makes zero LLM calls in production.** No Claude model runs inside MyInsuranceBro — the question is purely which model writes the code in Claude Code. Nothing here is a running cost of the product.

**Default to Claude Opus 5 for the whole build.** Rates (Anthropic API, per million tokens):

| Model | Input | Output | Context | Use it for |
|---|---|---|---|---|
| **Opus 5** | $5 | $25 | 1M | The default. Schema + RLS design, auth, Capacitor/WhatsApp integration, dashboard SQL, debugging |
| **Sonnet 5** | $3 ($2 intro to 2026-08-31) | $15 ($10 intro) | 1M | Repetitive work once patterns exist: CRUD screens, forms, styling passes, tests |
| Haiku 4.5 | $1 | $5 | 200K | Not for this build — fine for throwaway scripts |

**If you're on a Claude Pro or Max subscription, this is mostly moot** — model use comes out of your plan's limits rather than per-token billing, and the practical question becomes whether you hit usage limits. For a 5–7 week build of this size, a Max tier is the comfortable choice; Pro works if you keep sessions focused. Per-token API billing only makes sense if you specifically want metered cost control.

**Where the model choice actually matters:**

- **Opus 5, no substitutions:** the RLS policies (§4) and the `SECURITY DEFINER` metric functions (§7). These are the security boundary of the whole product — a subtly wrong policy leaks every broker's leads and looks fine in testing. Also the Capacitor/Android work (§13), where the failure modes are non-obvious and undocumented.
- **Sonnet 5 is genuinely enough** once Phase 1 establishes the patterns: the 6th lead-form field, the 4th filter chip, a styling pass over ported components. Near-Opus quality on coding at roughly half the price.

**Settings:** use `xhigh` effort for coding and agentic work; it's the sweet spot for this kind of build. Drop to `medium` for mechanical passes. Fast mode (`/fast`) runs the same Opus 5 with faster output at premium pricing — useful when iterating on UI, wasteful for schema design.

**The real cost lever isn't the model — it's context discipline.** Three things matter more than which model you pick:

1. **Write a `CLAUDE.md`** before Phase 0 (§13 suggests porting a trimmed `AI_AGENT_RULEBOOK.md`). Conventions restated every session cost more than they save.
2. **One task per session.** A session that scaffolds auth, then builds the leads list, then debugs Gradle carries all three contexts through every later request.
3. **Point at files, don't paste them.** The 1M context window is a ceiling, not a target.

---

*Next step after sign-off: scaffold Phase 0 — repo structure, ported theme and UI kit, database schema with RLS, phone-OTP auth, and a deployed URL you can log into.*
