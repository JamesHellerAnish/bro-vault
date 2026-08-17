"use client"

// components/charts/lazy.tsx
//
// Recharts is ~108 kB, and wiring it into the dashboard took that route's first-load JS from
// 194 kB to 312 kB. That is the wrong trade on this particular screen: `/` redirects to
// `/dashboard`, so it is the landing view, and PLAN.md's users are field brokers opening the
// app on a phone on patchy Indian mobile data. What they come for is the top of the page --
// follow-ups due today, overdue count, conversion rate. None of that needs a charting
// library, and none of it should wait for one to download.
//
// So the charts are code-split and client-only. The stat tiles paint from the initial bundle;
// Recharts arrives afterwards and the charts fill in.
//
// `ssr: false` is correct rather than merely convenient: Recharts measures the DOM to size
// its ResponsiveContainer, so it renders nothing useful on the server anyway. Prerendering it
// costs build time and ships markup that is immediately replaced.
//
// Each placeholder reserves its chart's real height. Without that the cards would grow when
// the library lands and shove the page around under someone's thumb -- the same layout-jump
// problem ChartCard's no-skeleton-on-refetch rule exists to prevent.

import dynamic from "next/dynamic"

function ChartPlaceholder({ height }: { height: number }) {
  return <div className="p-skeleton w-full rounded-xl" style={{ height }} aria-hidden />
}

export const PipelineFunnelChart = dynamic(
  () => import("@/components/charts/PipelineFunnelChart").then((m) => m.PipelineFunnelChart),
  { ssr: false, loading: () => <ChartPlaceholder height={232} /> }
)

export const ConversionTrendChart = dynamic(
  () => import("@/components/charts/ConversionTrendChart").then((m) => m.ConversionTrendChart),
  // 200 plot + ~28 legend row above it.
  { ssr: false, loading: () => <ChartPlaceholder height={228} /> }
)

export const ActivityMixChart = dynamic(
  () => import("@/components/charts/ActivityMixChart").then((m) => m.ActivityMixChart),
  // Height is data-dependent (rows * 34 + 28); 5 activity types is the common case.
  { ssr: false, loading: () => <ChartPlaceholder height={198} /> }
)
