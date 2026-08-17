"use client"

// Horizontal bars, because the stage names are long ("Negotiation / Docs") and horizontal
// gives them room to sit as readable left-aligned labels rather than rotated ticks.
//
// The ordinal ramp does the work here: color deepens as the stage advances, so the funnel's
// direction is visible even before reading the labels. See lib/chart-palette.ts for why this
// is ordinal rather than categorical, and for the validator output.
//
// One series, so no legend box -- the card title says what is plotted. Values are direct-
// labelled at the bar tip, which is legal precisely because there is only one number per bar.

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChartTooltip } from "@/components/charts/ChartCard"
import { CHART_AXIS_TEXT, CHART_GRID, FUNNEL_RAMP, MARK } from "@/lib/chart-palette"
import { PIPELINE_ORDER, STATUS_LABEL } from "@/lib/status"
import type { FunnelStage } from "@/lib/supabase/types"

export function PipelineFunnelChart({ funnel }: { funnel: FunnelStage[] }) {
  const data = PIPELINE_ORDER.map((status, i) => ({
    label: STATUS_LABEL[status],
    count: funnel.find((f) => f.status === status)?.lead_count ?? 0,
    fill: FUNNEL_RAMP[i] ?? FUNNEL_RAMP[FUNNEL_RAMP.length - 1]!,
  }))

  return (
    // Height covers plot + axis band. 6 rows x ~34px + 28px for the x-axis labels.
    <ResponsiveContainer width="100%" height={232}>
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
          width={116}
          tick={{ fill: CHART_AXIS_TEXT, fontSize: 11.5 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
        <Bar
          dataKey="count"
          name="Leads"
          maxBarSize={MARK.maxBarSize}
          radius={MARK.barRadiusH}
          isAnimationActive={false}
          label={{ position: "right", fill: CHART_AXIS_TEXT, fontSize: 11 }}
        >
          {/* Color follows the stage, never the value's rank -- a stage keeps its step
              whatever the counts do. */}
          {data.map((d) => (
            <Cell key={d.label} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
