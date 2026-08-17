// lib/format.ts
//
// Display helpers. The relative-time formatter is the fe-gmq pattern (PLAN.md section 13:
// "Just now / 4h ago / 3d ago / Mar 12" on every list row) -- it stops being useful past a
// week, so it hands off to an absolute date rather than saying "63d ago".

/** "Just now" / "12m ago" / "4h ago" / "3d ago" / "12 Mar" / "12 Mar 2025" */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso)
  const diffMs = Date.now() - then.getTime()
  const mins = Math.floor(diffMs / 60_000)

  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`

  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  const sameYear = then.getFullYear() === new Date().getFullYear()
  return then.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** Forward-looking counterpart, for next_follow_up_at. Overdue reads as overdue. */
export function relativeDue(iso: string | null | undefined): {
  label: string
  overdue: boolean
} {
  if (!iso) return { label: 'No follow-up set', overdue: false }
  const due = new Date(iso)
  const diffMs = due.getTime() - Date.now()
  const overdue = diffMs < 0
  const mins = Math.floor(Math.abs(diffMs) / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)

  const time = due.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

  if (days === 0 && !overdue && hours < 24) return { label: `Today ${time}`, overdue: false }
  if (overdue && days === 0) return { label: `Overdue by ${hours || mins}${hours ? 'h' : 'm'}`, overdue: true }
  if (overdue) return { label: `Overdue by ${days}d`, overdue: true }
  if (days === 1) return { label: `Tomorrow ${time}`, overdue: false }
  if (days < 7) return { label: `In ${days}d`, overdue: false }

  return {
    label: due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    overdue: false,
  }
}

/** Indian grouping: 12,34,567 rather than 1,234,567. */
export function inr(value: number | null | undefined, opts?: { compact?: boolean }): string {
  if (value === null || value === undefined) return '—'
  if (opts?.compact) {
    if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(value % 10_000_000 === 0 ? 0 : 1)}Cr`
    if (value >= 100_000) return `₹${(value / 100_000).toFixed(value % 100_000 === 0 ? 0 : 1)}L`
    if (value >= 1_000) return `₹${(value / 1_000).toFixed(0)}k`
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Hours from a metric function into something a person reads. Returns null-safe: an average
 * over zero conversions is null in Postgres and must not render as "0h".
 */
export function durationFromHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 48) return `${Math.round(hours)}h`
  return `${(hours / 24).toFixed(1)}d`
}

/** +919876543210 -> +91 98765 43210 */
export function prettyPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  const m = /^\+(\d{1,3})(\d{5})(\d{5})$/.exec(e164)
  if (!m) return e164
  return `+${m[1]} ${m[2]} ${m[3]}`
}

/** E.164 -> the bare digits wa.me expects (no plus, no spaces). */
export function waNumber(e164: string): string {
  return e164.replace(/[^0-9]/g, '')
}

export function initials(fullName: string | null | undefined): string {
  if (!fullName) return '?'
  const parts = fullName.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''
  return (first + last).toUpperCase() || '?'
}

/**
 * Fills {{placeholders}} in a message template. Anything with no value is left visible as
 * `{{name}}` rather than blanked, so the composer shows the broker what is missing instead
 * of quietly sending "Hello ," to a client.
 */
export function renderTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const v = vars[key]
    return v === null || v === undefined || v === '' ? whole : v
  })
}

/** Which {{placeholders}} in a template still have no value. */
export function missingVariables(body: string, vars: Record<string, string | null | undefined>): string[] {
  const found = new Set<string>()
  for (const m of body.matchAll(/\{\{(\w+)\}\}/g)) {
    const key = m[1]!
    const v = vars[key]
    if (v === null || v === undefined || v === '') found.add(key)
  }
  return [...found]
}

/**
 * "Documents pending" -> "documents_pending". Matches the key columns on public.traits,
 * public.lead_sources and public.insurance_types, which are all constrained to
 * ^[a-z0-9_]{2,40}$ (supabase/migrations/...000200_core_tables.sql). The admin types a
 * label; this derives the machine key so they never see or edit it directly.
 */
export function slugify(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return base.length >= 2 ? base : base.padEnd(2, '_')
}

/** Every {{placeholder}} referenced in a template, in first-seen order, deduplicated. */
export function extractVariables(...bodies: (string | null | undefined)[]): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const body of bodies) {
    if (!body) continue
    for (const m of body.matchAll(/\{\{(\w+)\}\}/g)) {
      const key = m[1]!
      if (!seen.has(key)) {
        seen.add(key)
        found.push(key)
      }
    }
  }
  return found
}
