"use client"

// components/charts/ChartCard.tsx
//
// The frame every chart on the dashboard sits in, so three requirements are satisfied once
// rather than per-chart and cannot be forgotten on the fourth one someone adds later:
//
//   * A TABLE-VIEW TWIN. Every chart has a "Table" toggle showing the same numbers as text.
//     This is the accessibility floor -- a value that exists only as a bar length, or only
//     inside a tooltip, is unreachable for a screen reader and for anyone who cannot resolve
//     the colors. It also happens to be the thing people actually want when they are trying
//     to read an exact figure.
//   * NO SKELETON FLASH ON REFETCH. Changing the date range refetches; swapping to a
//     skeleton would collapse the card's height and bounce the page. The previous render is
//     held at reduced opacity instead, so nothing jumps.
//   * THE CONTAINER INCLUDES THE AXIS BAND. The height passed here is the plot; the axis
//     labels get their own space below it. Sizing the container to the plot alone is what
//     produces a card with its own tiny scrollbar.

import { useId, useState } from "react"
import { BarChart3, Table2 } from "lucide-react"
import { cn } from "@/lib/utils"

export interface TableColumn {
  header: string
  align?: "left" | "right"
}

export function ChartCard({
  title,
  subtitle,
  isFetching = false,
  isEmpty = false,
  emptyMessage = "Nothing to show for this period.",
  tableColumns,
  tableRows,
  children,
  action,
}: {
  title: string
  subtitle?: string
  isFetching?: boolean
  isEmpty?: boolean
  emptyMessage?: string
  /** The chart's data as text. Required -- see the table-view note above. */
  tableColumns: TableColumn[]
  tableRows: (string | number)[][]
  children: React.ReactNode
  action?: React.ReactNode
}) {
  const [view, setView] = useState<"chart" | "table">("chart")
  const tableId = useId()

  return (
    <section className="p-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="p-section-title">{title}</h2>
          {subtitle && <p className="p-section-subtitle">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <div className="flex rounded-full p-0.5" style={{ background: "#F3F4F6" }}>
            <button
              onClick={() => setView("chart")}
              aria-pressed={view === "chart"}
              aria-label="Chart view"
              className={cn("flex h-7 w-7 items-center justify-center rounded-full transition-colors")}
              style={view === "chart" ? { background: "#FFFFFF", boxShadow: "var(--p-shadow-sm)" } : undefined}
            >
              <BarChart3
                className="h-[15px] w-[15px]"
                style={{ color: view === "chart" ? "var(--p-text)" : "var(--p-text-tertiary)" }}
              />
            </button>
            <button
              onClick={() => setView("table")}
              aria-pressed={view === "table"}
              aria-label="Table view"
              aria-controls={tableId}
              className={cn("flex h-7 w-7 items-center justify-center rounded-full transition-colors")}
              style={view === "table" ? { background: "#FFFFFF", boxShadow: "var(--p-shadow-sm)" } : undefined}
            >
              <Table2
                className="h-[15px] w-[15px]"
                style={{ color: view === "table" ? "var(--p-text)" : "var(--p-text-tertiary)" }}
              />
            </button>
          </div>
        </div>
      </div>

      {isEmpty ? (
        <p className="mt-6 mb-2 text-center text-[13px]" style={{ color: "var(--p-text-tertiary)" }}>
          {emptyMessage}
        </p>
      ) : (
        // Hold the previous render at reduced opacity while refetching -- never a skeleton,
        // which would collapse the height and bounce the layout.
        <div
          className="mt-4 transition-opacity duration-200"
          style={{ opacity: isFetching ? 0.45 : 1 }}
        >
          {view === "chart" ? (
            children
          ) : (
            <div className="overflow-x-auto">
              <table id={tableId} className="w-full text-[13px]">
                <thead>
                  <tr>
                    {tableColumns.map((c) => (
                      <th
                        key={c.header}
                        scope="col"
                        className={cn(
                          "border-b pb-2 font-medium",
                          c.align === "right" ? "text-right" : "text-left"
                        )}
                        style={{ color: "var(--p-text-tertiary)", borderColor: "var(--p-border)" }}
                      >
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          className={cn(
                            "border-b py-2",
                            tableColumns[j]?.align === "right" && "text-right tabular-nums"
                          )}
                          style={{ color: "var(--p-text)", borderColor: "var(--p-border-subtle)" }}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Shared tooltip. Text wears text tokens, never the series color -- identity comes from the
 * colored swatch beside it. A light hue as text is illegible on a white surface.
 */
export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name?: string; value?: number | string; color?: string }[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-xl px-3 py-2"
      style={{ background: "#FFFFFF", boxShadow: "var(--p-shadow-lg)", border: "1px solid var(--p-border)" }}
    >
      {label !== undefined && (
        <p className="mb-1 text-[12px] font-semibold" style={{ color: "var(--p-text)" }}>
          {label}
        </p>
      )}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--p-text-secondary)" }}>
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: entry.color }}
            aria-hidden
          />
          {entry.name}: <span className="font-semibold tabular-nums" style={{ color: "var(--p-text)" }}>{entry.value}</span>
        </p>
      ))}
    </div>
  )
}
