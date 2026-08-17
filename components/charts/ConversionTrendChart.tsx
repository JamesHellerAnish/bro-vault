"use client"

// Two series over time -- the one genuinely categorical chart on this dashboard.
//
// Both series sit on ONE y-axis, and they can: "leads received" and "leads converted" are the
// same unit (a count of leads), so a shared scale is honest and the gap between the lines is
// the conversion story. A second axis would invent a relationship that is not in the data --
// the single most misleading thing a chart can do, and worth stating because "conversion rate"
// is right there as a tempting second scale. It lives on its own stat tile instead.
//
// Legend is always present for 2+ series; the endpoint of each line is direct-labelled so the
// reader can identify the lines without color-matching. No number on every point.

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChartTooltip } from "@/components/charts/ChartCard"
import { CHART_AXIS_TEXT, CHART_GRID, CHART_SURFACE, MARK, SERIES } from "@/lib/chart-palette"
import type { ConversionTrendPoint } from "@/lib/supabase/types"

export function ConversionTrendChart({ points }: { points: ConversionTrendPoint[] }) {
  const data = points.map((p) => ({
    label: shortDate(p.bucket_start),
    received: p.leads_received,
    converted: p.leads_converted,
  }))

  return (
    <>
      {/* The legend is markup, not a Recharts <Legend>: it needs to sit above the plot and
          match the rest of the app's type, and identity comes from the swatch beside text in
          a text token -- never from coloring the text itself. */}
      <div className="mb-3 flex items-center gap-4">
        <LegendKey color={SERIES.received} label="Received" />
        <LegendKey color={SERIES.converted} label="Converted" />
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke={CHART_GRID} strokeWidth={1} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART_AXIS_TEXT, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={18}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: CHART_AXIS_TEXT, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART_GRID, strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="received"
            name="Received"
            stroke={SERIES.received}
            strokeWidth={MARK.lineWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            // 2px surface ring so the markers stay legible where the lines cross.
            dot={{ r: MARK.dotRadius, fill: SERIES.received, stroke: CHART_SURFACE, strokeWidth: MARK.dotRingWidth }}
            activeDot={{ r: MARK.dotRadius + 2, stroke: CHART_SURFACE, strokeWidth: MARK.dotRingWidth }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="converted"
            name="Converted"
            stroke={SERIES.converted}
            strokeWidth={MARK.lineWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: MARK.dotRadius, fill: SERIES.converted, stroke: CHART_SURFACE, strokeWidth: MARK.dotRingWidth }}
            activeDot={{ r: MARK.dotRadius + 2, stroke: CHART_SURFACE, strokeWidth: MARK.dotRingWidth }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </>
  )
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: color }} aria-hidden />
      <span className="text-[12px]" style={{ color: "var(--p-text-secondary)" }}>
        {label}
      </span>
    </span>
  )
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}
