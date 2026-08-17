// lib/chart-palette.ts
//
// Chart color, kept out of the components so it is decided once and validated once.
//
// Every value below was produced by snapping this product's existing theme hues
// (app/broker-theme.css) to steps that pass the validator, then running it -- not by eye:
//
//   node scripts/validate_palette.js "#2563EB,#059669" --mode light
//     -> ALL CHECKS PASS (worst adjacent ΔE 24.9 deutan, 27.2 normal)
//
//   node scripts/validate_palette.js "#8FB3E6,#6E99DA,#4E7FC9,#3566B0,#214F92,#123C70" \
//     --ordinal --mode light
//     -> ALL CHECKS PASS (monotone L, all gaps >= 0.06, light end 2.10:1)
//
// The first ordinal attempt failed twice -- the light end sat at 1.22:1 against the surface
// (invisible) and the last two steps were 0.055 apart (indistinguishable). Both were found
// by running the checks, not by looking, which is the entire point of having them.
//
// Light mode only, deliberately: broker-theme.css defines no dark tokens, so the app has no
// dark mode. Shipping dark chart steps for a light-only app would be an untested code path
// pretending to be a feature. When dark mode arrives, these get re-validated against the
// dark surface -- not flipped automatically.

/**
 * PIPELINE STAGES ARE ORDINAL, NOT CATEGORICAL.
 *
 * Reordering New -> Contacted -> ... -> Converted changes what the chart means, which is the
 * test for ordinal. So the funnel takes one hue in monotone lightness steps and the reader
 * sees the progression in the color itself. Giving each stage its own hue would spend the
 * identity channel on something bar length already encodes, and would fail the categorical
 * checks by construction.
 *
 * Six steps for the six pipeline stages in PIPELINE_ORDER. Light -> dark, so "further along"
 * reads as "deeper".
 */
export const FUNNEL_RAMP = [
  "#8FB3E6",
  "#6E99DA",
  "#4E7FC9",
  "#3566B0",
  "#214F92",
  "#123C70",
] as const

/**
 * Categorical slots, assigned in fixed order and never cycled. Two are enough for
 * everything on this dashboard; a third series would need re-validating, not improvising.
 *
 * Assignment is by entity, never by rank -- "leads received" is always slot 1 regardless of
 * which line happens to be on top, so filtering never repaints the survivors.
 */
export const SERIES = {
  received: "#2563EB",
  converted: "#059669",
} as const

/** One hue for nominal bars (activity mix). One series, one color -- never a value ramp. */
export const NOMINAL_BAR = "#2563EB"

/** Gridlines. Hairline, solid, one step off the surface -- never dashed. Not text, so the
 *  1.13:1 against white is correct here: a gridline that competes with the data is worse
 *  than one that is barely there. */
export const CHART_GRID = "#EFF1F4"

/**
 * Axis ticks and direct value labels.
 *
 * This is --p-text-secondary (#6B7280, 4.83:1 on white), NOT --p-text-tertiary (#9CA3AF).
 * Tertiary is the natural-looking choice for recessive chart chrome and it is what this file
 * used first -- but a WCAG text-contrast check put it at 2.54:1, well under the 4.5:1 needed
 * for normal text. Axis ticks and value labels at 11px ARE text: they carry the numbers a
 * reader cannot get from bar length alone.
 *
 * "Recessive" governs weight and size, not legibility. Caught by running
 * `contrast()` from the validator rather than by looking, which is the whole point.
 */
export const CHART_AXIS_TEXT = "#6B7280"

export const CHART_SURFACE = "#FFFFFF"

/** Mark specs from the design system, so components cannot drift from them. */
export const MARK = {
  /** Bars are capped, never filling their band -- the leftover is deliberate air. */
  maxBarSize: 22,
  /** 4px rounded data-end, square at the baseline. */
  barRadiusH: [0, 4, 4, 0] as [number, number, number, number],
  lineWidth: 2,
  dotRadius: 4,
  /** 2px ring in the surface color so markers stay legible where they overlap. */
  dotRingWidth: 2,
} as const
