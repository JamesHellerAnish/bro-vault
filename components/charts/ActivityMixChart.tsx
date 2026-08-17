"use client"

// Effort against outcome, from PLAN.md section 7's "Activity count (calls, WhatsApps,
// emails): effort against outcome".
//
// Call / WhatsApp / Email / Meeting / Note are NOMINAL -- reordering them changes nothing --
// so every bar takes the same slot-1 hue. Colouring them by value would double-encode what
// bar length already shows and spend the identity channel on nothing; giving each its own
// hue would imply a relationship between the categories that does not exist.
//
// One series, so no legend. Values direct-labelled at the tip.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChartTooltip } from "@/components/charts/ChartCard"
import { CHART_AXIS_TEXT, CHART_GRID, MARK, NOMINAL_BAR } from "@/lib/chart-palette"
import { ACTIVITY_LABEL } from "@/lib/status"
import type { ActivitySummaryRow } from "@/lib/supabase/types"

export function ActivityMixChart({ rows }: { rows: ActivitySummaryRow[] }) {
  const data = rows.map((r) => ({
    label: ACTIVITY_LABEL[r.type],
    count: r.activity_count,
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 34 + 28)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 34, bottom: 0, left: 0 }}>
        <CartesianGrid horizontal={false} stroke={CHART_GRID} strokeWidth={1} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fill: CHART_AXIS_TEXT, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={78}
          tick={{ fill: CHART_AXIS_TEXT, fontSize: 11.5 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
        <Bar
          dataKey="count"
          name="Activities"
          fill={NOMINAL_BAR}
          maxBarSize={MARK.maxBarSize}
          radius={MARK.barRadiusH}
          isAnimationActive={false}
          label={{ position: "right", fill: CHART_AXIS_TEXT, fontSize: 11 }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
