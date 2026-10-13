// Pure helpers: what to draw, in what order, at what size. No engine calls,
// so each one can be tested on its own.

import type { Limit, Segment } from '../types'
import {
  CATEGORY_COLORS,
  DIVISION_COLOR,
  EARLY_DANGER_AT,
  EARLY_WARN_AT,
  FALLBACK_COLOR,
  FREE_COLOR,
  HATCH_BASE_OPACITY,
  HATCH_SPACING,
  HATCH_STRIPE,
  LIMIT_COLORS,
  MIN_VISIBLE_SHARE,
  OUTLINE_COLOR,
  PACE_COLOR,
  PROJECTION_DANGER_AT,
  PROJECTION_MIN_ELAPSED,
  PROJECTION_WARN_AT,
  USED_DANGER_AT,
} from './config'

/** The colour a segment is drawn in, in the bar and the legend alike. */
export const colorOf = (s: Segment) =>
  s.kind === 'free' ? FREE_COLOR : CATEGORY_COLORS[s.name] ?? FALLBACK_COLOR

/** `tokens` as a share of `window`, one decimal, no sign: `"12.3"`. */
export const percent = (tokens: number, window: number) =>
  window > 0 ? ((tokens / window) * 100).toFixed(1) : '0.0'

/**
 * The one order bar and legend share: the compaction reserve first, then
 * what is used as /context lists it, free space last.
 */
export const ordered = (segments: readonly Segment[]): Segment[] => [
  ...segments.filter(s => s.kind === 'buffer'),
  ...segments.filter(s => s.kind !== 'buffer' && s.kind !== 'free'),
  ...segments.filter(s => s.kind === 'free'),
]

/**
 * The segments the bar fills, left to right. Free space is not one of them:
 * it is whatever they leave. Anything under the visibility threshold is
 * legend-only.
 */
export const barSegments = (segments: readonly Segment[], window: number) =>
  segments.filter(s => s.kind !== 'free' && s.tokens / window >= MIN_VISIBLE_SHARE)

/** Tokens taken from the window: everything but free space. */
export const usedTokens = (segments: readonly Segment[]) =>
  segments.filter(s => s.kind !== 'free').reduce((n, s) => n + s.tokens, 0)

/**
 * The bar as an SVG document for the desktop app: a free-space track, the
 * filled segments laid edge to edge on it, and an outline around it all.
 * Widths are exact (fractions of a pixel), so there are no gaps.
 */
export function barSvg(filled: readonly Segment[], window: number): string {
  const W = 1000 // viewBox units; stretched to whatever width the band has
  const H = 10

  let x = 0
  const rects = filled.map(s => {
    const w = Math.min((s.tokens / window) * W, W - x)
    const box = `x="${x.toFixed(3)}" y="0" width="${w.toFixed(3)}" height="${H}"`
    x += w
    return s.kind === 'buffer'
      ? `<rect ${box} fill="${colorOf(s)}" fill-opacity="${HATCH_BASE_OPACITY}"/>` +
          `<rect ${box} fill="url(#hatch)"/>`
      : `<rect ${box} fill="${colorOf(s)}"/>`
  })

  const reserve = CATEGORY_COLORS['Autocompact buffer'] ?? FALLBACK_COLOR
  const whole = `x="0" y="0" width="${W}" height="${H}"`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`,
    `<defs><pattern id="hatch" width="${HATCH_SPACING}" height="${H}" patternUnits="userSpaceOnUse">`,
    `<rect x="0" y="0" width="${HATCH_STRIPE}" height="${H}" fill="${reserve}"/></pattern></defs>`,
    `<rect ${whole} fill="${FREE_COLOR}"/>`,
    ...rects,
    // Half the stroke falls outside and is clipped, leaving a 1px line.
    `<rect ${whole} fill="none" stroke="${OUTLINE_COLOR}" stroke-width="2" vector-effect="non-scaling-stroke"/>`,
    `</svg>`,
  ].join('')
}

/**
 * The bar in whole terminal cells: how many each filled segment gets, and
 * how many are left for free space. Rounded cumulatively, so the cells add
 * up to exactly `width`.
 */
export function barCells(filled: readonly Segment[], window: number, width: number) {
  let acc = 0
  let prev = 0
  const cells = filled.map(segment => {
    acc += segment.tokens
    const end = Math.round((Math.min(acc, window) / window) * width)
    const count = end - prev
    prev = end
    return { segment, count }
  })
  return { cells, free: width - prev }
}

// ── Usage limits ────────────────────────────────────────────────────────────

export type LimitLevel = keyof typeof LIMIT_COLORS

/**
 * Where the current pace leads by the reset, in percent of the limit:
 * `percentUsed` over the share of the window that has passed. `undefined`
 * while too little of the window has passed for the pace to mean much.
 */
export function projectedPercent(percentUsed: number, elapsed: number | undefined) {
  if (elapsed === undefined || elapsed < PROJECTION_MIN_ELAPSED) return undefined
  return percentUsed / elapsed
}

/**
 * How a limit stands: red once nearly used up, otherwise by the projection,
 * or early in the window by the share used alone.
 */
export function limitLevel(percentUsed: number, elapsed: number | undefined): LimitLevel {
  if (percentUsed >= USED_DANGER_AT) return 'danger'
  const projected = projectedPercent(percentUsed, elapsed)
  if (projected === undefined) {
    return percentUsed >= EARLY_DANGER_AT ? 'danger' : percentUsed >= EARLY_WARN_AT ? 'warn' : 'ok'
  }
  return projected >= PROJECTION_DANGER_AT ? 'danger' : projected >= PROJECTION_WARN_AT ? 'warn' : 'ok'
}

/** The colour a limit bar, its label and its button dot take. */
export const limitColor = (percentUsed: number, elapsed: number | undefined) =>
  LIMIT_COLORS[limitLevel(percentUsed, elapsed)]

/**
 * Time until `resetsAt`, short: `"2h 10m"`, `"3d 4h"`, `"45m"`; `""` when
 * unknown or past.
 */
export function timeUntil(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return ''
  const minutes = Math.ceil(ms / 60_000)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * The label in front of a limit bar: `"◷ Session 42% · 2h 10m"`, or with
 * `projected` given, `"◷ Session 48% → 240% · 2h 10m"`.
 */
export function limitLabel(icon: string, label: string, limit: Limit, now: number, projected?: number): string {
  const left = timeUntil(limit.resetsAt, now)
  const toward = projected === undefined ? '' : ` → ${Math.min(Math.round(projected), 999)}%`
  return `${icon} ${label} ${Math.round(limit.percentUsed)}%${toward}${left ? ` · ${left}` : ''}`
}

/**
 * How much of a window of `hours` has passed, 0 to 1, from when it resets;
 * `undefined` when the reset time is unknown.
 */
export function elapsedShare(resetsAt: string | undefined, hours: number, now: number) {
  if (!resetsAt) return undefined
  const left = Date.parse(resetsAt) - now
  if (Number.isNaN(left)) return undefined
  return Math.min(Math.max(1 - left / (hours * 3_600_000), 0), 1)
}

const clampPercent = (p: number) => Math.min(Math.max(p, 0), 100)

/**
 * A limit as a thin SVG bar: a track filled from the left to its share in
 * `color`, split into `divisions` equal parts, with the pace marker at `pace`
 * (0 to 1) when one is given.
 *
 * Drawn at `heightPx`, the app sizes the width from the document's own
 * proportions; they are set wide enough that every bar, thick or thin, fills
 * the space it is given rather than stopping short.
 */
export function limitSvg(percentUsed: number, color: string, divisions: number, heightPx: number, pace?: number): string {
  const W = 1000
  const H = 10
  const DRAWN_WIDTH = 8000 // wider than any band, at any height
  const w = (clampPercent(percentUsed) / 100) * W
  const whole = `x="0" y="0" width="${W}" height="${H}"`
  const line = (x: number, color: string, px: number) =>
    `<line x1="${x.toFixed(3)}" y1="0" x2="${x.toFixed(3)}" y2="${H}" stroke="${color}" stroke-width="${px}" vector-effect="non-scaling-stroke"/>`

  const dividers = Array.from({ length: Math.max(divisions - 1, 0) }, (_, i) =>
    line(((i + 1) / divisions) * W, DIVISION_COLOR, 1),
  )

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DRAWN_WIDTH}" height="${heightPx}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`,
    `<rect ${whole} fill="${FREE_COLOR}"/>`,
    `<rect x="0" y="0" width="${w.toFixed(3)}" height="${H}" fill="${color}"/>`,
    ...dividers,
    `<rect ${whole} fill="none" stroke="${OUTLINE_COLOR}" stroke-width="2" vector-effect="non-scaling-stroke"/>`,
    pace === undefined ? '' : line(pace * W, PACE_COLOR, 2),
    `</svg>`,
  ].join('')
}

/**
 * A limit in whole terminal cells: how many are used, how many free, and the
 * cell the pace marker sits on (`undefined` for none). Used and free add up
 * to `width`.
 */
export function limitCells(percentUsed: number, width: number, pace?: number) {
  const used = Math.round((clampPercent(percentUsed) / 100) * width)
  const paceAt = pace === undefined ? undefined : Math.min(Math.round(pace * width), width - 1)
  return { used, free: width - used, paceAt }
}

// ── Toggle dots ─────────────────────────────────────────────────────────────

/**
 * A toggle's dot as a small SVG, `px` square: a filled circle when `filled`,
 * otherwise a ring of `strokePx` that keeps the same outer size. Both are in
 * screen pixels; `drawnPx` is the size to draw it at (`cssPx(px, scale)`), so
 * that it lands on whole screen pixels.
 */
export function dotSvg(color: string, filled: boolean, px: number, strokePx: number, drawnPx = px): string {
  const r = px / 2
  const shape = filled
    ? `<circle cx="${r}" cy="${r}" r="${r}" fill="${color}"/>`
    : `<circle cx="${r}" cy="${r}" r="${r - strokePx / 2}" fill="none" stroke="${color}" stroke-width="${strokePx}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${drawnPx}" height="${drawnPx}" viewBox="0 0 ${px} ${px}">${shape}</svg>`
}

// ── Screen scale ────────────────────────────────────────────────────────────

/**
 * The CSS height that comes out at exactly `screenPx` screen pixels when the
 * app draws at `scale` (its zoom times the display scaling). A whole number of
 * screen pixels is rounded the same way wherever the element falls, so equal
 * bars stay equal.
 */
export const cssPx = (screenPx: number, scale: number) => (scale > 0 ? screenPx / scale : screenPx)

/** The app's zoom from the text of its config.json; 1 when absent or unreadable. */
export function zoomFromConfig(text: string | undefined): number {
  if (!text) return 1
  try {
    const zoom = JSON.parse(text).windowControlsZoomFactor
    return typeof zoom === 'number' && zoom > 0 ? zoom : 1
  } catch {
    return 1
  }
}
