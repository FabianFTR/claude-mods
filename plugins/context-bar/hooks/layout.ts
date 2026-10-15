// Pure helpers: what to draw, in what order, at what size. No engine calls,
// so each one can be tested on its own.

import type { Limit, Segment } from '../types'
import {
  AUTO_CONTEXT_PREFIXES,
  CATEGORY_COLORS,
  COMMAND_TOOLS,
  COMPACTION_SUMMARY_PREFIX,
  DIVISION_COLOR,
  EARLY_DANGER_AT,
  EARLY_WARN_AT,
  EDIT_TOOLS,
  FALLBACK_COLOR,
  FREE_COLOR,
  LIGHT_THEME_COLORS,
  HATCH_BASE_OPACITY,
  HATCH_SPACING,
  HATCH_STRIPE,
  IMAGE_TOKENS_ESTIMATE,
  LIMIT_COLORS,
  MESSAGE_PART_NAMES,
  MIN_VISIBLE_SHARE,
  OTHER_MIN_BAR_SHARE,
  OTHER_NAME,
  OUTLINE_COLOR,
  PACE_COLOR,
  TOGGLE_OFF_DOT_COLOR,
  TOGGLE_OFF_TEXT_COLOR,
  TOGGLE_ON_TEXT_COLOR,
  PROJECTION_DANGER_AT,
  PROJECTION_MIN_ELAPSED,
  PROJECTION_WARN_AT,
  READ_TOOLS,
  SHELL_READ_COMMANDS,
  USED_DANGER_AT,
} from './config'

// ── Theme ───────────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light'

/** Every colour the band draws with, for one theme. */
export type Palette = {
  categories: Record<string, string>
  free: string
  outline: string
  division: string
  pace: string
  toggleOnText: string
  toggleOffText: string
  toggleOffDot: string
}

const DARK: Palette = {
  categories: CATEGORY_COLORS,
  free: FREE_COLOR,
  outline: OUTLINE_COLOR,
  division: DIVISION_COLOR,
  pace: PACE_COLOR,
  toggleOnText: TOGGLE_ON_TEXT_COLOR,
  toggleOffText: TOGGLE_OFF_TEXT_COLOR,
  toggleOffDot: TOGGLE_OFF_DOT_COLOR,
}

const LIGHT: Palette = {
  ...DARK,
  ...LIGHT_THEME_COLORS,
  categories: { ...CATEGORY_COLORS, ...LIGHT_THEME_COLORS.categories },
}

let palette = DARK

/** Switches every colour below to the theme's; the band calls it as it draws. */
export function useTheme(theme: Theme) {
  palette = theme === 'light' ? LIGHT : DARK
}

/** The colours of the current theme. */
export const colors = (): Palette => palette

/** The system theme from `reg query ... AppsUseLightTheme` (Windows) or `defaults read -g AppleInterfaceStyle` (macOS). */
export function themeFromSystem(output: { windows?: string; mac?: string }): Theme {
  if (output.windows !== undefined) return /AppsUseLightTheme\s+REG_DWORD\s+0x0*1\b/.test(output.windows) ? 'light' : 'dark'
  if (output.mac !== undefined) return /dark/i.test(output.mac) ? 'dark' : 'light'
  return 'dark'
}

/** The colour a segment is drawn in, in the bar and the legend alike; Other by its name. */
export const colorOf = (s: Segment) =>
  s.kind === 'free' ? palette.free : palette.categories[s.name] ?? FALLBACK_COLOR

// ── Numbers ─────────────────────────────────────────────────────────────────

/** Tokens, short: `800`, `3.2k`, `44k`, `1.2M`. */
export function formatTokens(n: number): string {
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(Math.round(n))
  if (a < 1000) return `${sign}${a}`
  if (a < 1_000_000) return `${sign}${(a / 1000).toFixed(a < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${sign}${(a / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** What the last reply added: `+3.2k last reply`; empty when nothing changed or unknown. */
export function growthLabel(delta: number | null): string {
  if (delta === null || Math.round(delta) === 0) return ''
  return `${delta > 0 ? '+' : ''}${formatTokens(delta)} last reply`
}

/** The session's cost, `$1.24 session`, when it should show; empty otherwise. */
export function costLabel(usd: number | null, mode: 'auto' | 'always' | 'never', onSubscription: boolean): string {
  if (usd === null || mode === 'never') return ''
  if (mode === 'auto' && (onSubscription || usd <= 0)) return ''
  return `$${usd.toFixed(usd < 10 ? 2 : 1)} session`
}

/** Text safe inside SVG markup. */
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A segment's hover text: `Commands · 44k · 22.2%`. */
export const segmentTitle = (name: string, tokens: number, window: number) =>
  `${name} · ${formatTokens(tokens)} · ${percent(tokens, window)}%`

// ── Alerts ──────────────────────────────────────────────────────────────────

/** How full the context window is, in percent: everything but free space. */
export const contextFullPercent = (segments: readonly Segment[], window: number) =>
  window > 0 ? (100 * (window - segments.filter(s => s.kind === 'free').reduce((n, s) => n + s.tokens, 0))) / window : 0

/**
 * Whether to raise an alert for a value against its threshold, given whether
 * it was raised already: once on crossing up, then not again until the value
 * has dropped `reset` below the threshold.
 */
export function alertStep(value: number, threshold: number, wasAlerted: boolean, reset = 5) {
  if (value >= threshold) return { raise: !wasAlerted, alerted: true }
  return { raise: false, alerted: wasAlerted && value > threshold - reset }
}

/** `tokens` as a share of `window`, one decimal, no sign: `"12.3"`. */
export const percent = (tokens: number, window: number) =>
  window > 0 ? ((tokens / window) * 100).toFixed(1) : '0.0'

/** What the bar and legend show, and what is gathered into Other. */
export type Grouped = {
  /** In bar and legend order: the compaction reserve, Other, the rest smallest first, free space. */
  segments: Segment[]
  /** What Other holds, smallest first: hidden categories and those under MIN_VISIBLE_SHARE. */
  inOther: Segment[]
}

/**
 * Sorts the breakdown for the bar and legend. Hidden categories, and any
 * under MIN_VISIBLE_SHARE of the window, are gathered into one `Other`
 * segment. Order: the compaction reserve, Other, the rest from smallest to
 * largest, free space last. Free space is never hidden.
 */
export function groupSegments(segments: readonly Segment[], window: number, hidden: readonly string[]): Grouped {
  const isHidden = (s: Segment) => hidden.includes(s.name)
  const isSmall = (s: Segment) => window > 0 && s.tokens / window < MIN_VISIBLE_SHARE
  const bySize = (a: Segment, b: Segment) => a.tokens - b.tokens

  const used = segments.filter(s => s.kind !== 'free')
  const inOther = used.filter(s => isHidden(s) || isSmall(s)).sort(bySize)
  const shown = used.filter(s => !inOther.includes(s))

  const other: Segment[] = inOther.length
    ? [{ name: OTHER_NAME, tokens: inOther.reduce((n, s) => n + s.tokens, 0), color: '', kind: 'other' }]
    : []
  return {
    segments: [
      ...shown.filter(s => s.kind === 'buffer'),
      ...other,
      ...shown.filter(s => s.kind !== 'buffer').sort(bySize),
      ...segments.filter(s => s.kind === 'free'),
    ],
    inOther,
  }
}

/** The segments the bar fills, left to right; free space is what they leave. */
export const barSegments = (grouped: Grouped) => grouped.segments.filter(s => s.kind !== 'free')

/** Tokens taken from the window: everything but free space. */
export const usedTokens = (segments: readonly Segment[]) =>
  segments.filter(s => s.kind !== 'free').reduce((n, s) => n + s.tokens, 0)

/**
 * The bar as an SVG document for the desktop app: a free-space track, the
 * filled segments laid edge to edge on it, and an outline around it all.
 * Widths are exact (fractions of a pixel), so there are no gaps.
 */
export function barSvg(filled: readonly Segment[], window: number, titles = false): string {
  const W = 1000 // viewBox units; stretched to whatever width the band has
  const H = 10

  let x = 0
  const rects = filled.map(s => {
    // Other is drawn at least OTHER_MIN_BAR_SHARE wide, so it shows when tiny.
    const share = s.kind === 'other' ? Math.max(s.tokens / window, OTHER_MIN_BAR_SHARE) : s.tokens / window
    const w = Math.min(share * W, W - x)
    const box = `x="${x.toFixed(3)}" y="0" width="${w.toFixed(3)}" height="${H}"`
    x += w
    const title = titles ? `<title>${xml(segmentTitle(s.name, s.tokens, window))}</title>` : ''
    return s.kind === 'buffer'
      ? `<rect ${box} fill="${colorOf(s)}" fill-opacity="${HATCH_BASE_OPACITY}"/>` +
          `<rect ${box} fill="url(#hatch)">${title}</rect>`
      : `<rect ${box} fill="${colorOf(s)}">${title}</rect>`
  })

  const freeTokens = Math.max(0, window - filled.reduce((n, s) => n + s.tokens, 0))
  const freeTitle = titles ? `<title>${xml(segmentTitle('Free space', freeTokens, window))}</title>` : ''
  const reserve = palette.categories['Autocompact buffer'] ?? FALLBACK_COLOR
  const whole = `x="0" y="0" width="${W}" height="${H}"`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`,
    `<defs><pattern id="hatch" width="${HATCH_SPACING}" height="${H}" patternUnits="userSpaceOnUse">`,
    `<rect x="0" y="0" width="${HATCH_STRIPE}" height="${H}" fill="${reserve}"/></pattern></defs>`,
    `<rect ${whole} fill="${palette.free}">${freeTitle}</rect>`,
    ...rects,
    // Half the stroke falls outside and is clipped, leaving a 1px line.
    `<rect ${whole} fill="none" stroke="${palette.outline}" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`,
    `</svg>`,
  ].join('')
}

/**
 * The bar in whole terminal cells: how many each filled segment gets, and
 * how many are left for free space. Rounded cumulatively, so the cells add
 * up to exactly `width`. Other gets at least one cell, taken from free space.
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
  let free = width - prev
  const other = cells.find(c => c.segment.kind === 'other')
  if (other && other.count === 0 && free > 0) {
    other.count = 1
    free -= 1
  }
  return { cells, free }
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
export function limitSvg(percentUsed: number, color: string, divisions: number, heightPx: number, pace?: number, title?: string): string {
  const W = 1000
  const H = 10
  const DRAWN_WIDTH = 8000 // wider than any band, at any height
  const w = (clampPercent(percentUsed) / 100) * W
  const whole = `x="0" y="0" width="${W}" height="${H}"`
  const line = (x: number, color: string, px: number) =>
    `<line x1="${x.toFixed(3)}" y1="0" x2="${x.toFixed(3)}" y2="${H}" stroke="${color}" stroke-width="${px}" vector-effect="non-scaling-stroke"/>`

  const dividers = Array.from({ length: Math.max(divisions - 1, 0) }, (_, i) =>
    line(((i + 1) / divisions) * W, palette.division, 1),
  )

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DRAWN_WIDTH}" height="${heightPx}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`,
    title ? `<title>${xml(title)}</title>` : '',
    `<rect ${whole} fill="${palette.free}"/>`,
    `<rect x="0" y="0" width="${w.toFixed(3)}" height="${H}" fill="${color}"/>`,
    ...dividers,
    `<rect ${whole} fill="none" stroke="${palette.outline}" stroke-width="2" vector-effect="non-scaling-stroke"/>`,
    pace === undefined ? '' : line(pace * W, palette.pace, 2),
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

// ── Messages split ──────────────────────────────────────────────────────────

/** One content block of a conversation message, as the session hands it over. */
export type ChatBlock = { type: string; [field: string]: unknown }
/** One conversation message in Messages API form. */
export type ChatMessage = { role: 'user' | 'assistant'; content: readonly ChatBlock[] }

export type MessagePart = keyof typeof MESSAGE_PART_NAMES
export type MessageWeights = Record<MessagePart, number>

const PARTS = Object.keys(MESSAGE_PART_NAMES) as MessagePart[]
const noWeights = (): MessageWeights =>
  Object.fromEntries(PARTS.map(p => [p, 0])) as MessageWeights

// Rough tokens in a text: about four characters each. Only the proportions
// between parts matter, since the official total is what gets split.
const textWeight = (text: string) => text.length / 4

const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The first `count` bytes of base64 data, decoded; enough to read an image header. */
function headBytes(base64: string, count: number): number[] {
  const bytes: number[] = []
  let bits = 0
  let buffer = 0
  for (const ch of base64) {
    const value = BASE64.indexOf(ch)
    if (value < 0) continue
    buffer = ((buffer << 6) | value) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
      if (bytes.length >= count) break
    }
  }
  return bytes
}

/** Width and height from a PNG, GIF, WebP or JPEG header; undefined otherwise. */
export function imageSize(base64: string): { width: number; height: number } | undefined {
  const b = headBytes(base64.slice(0, 96_000), 72_000)
  const at = (i: number) => b[i] ?? 0
  const u16be = (i: number) => (at(i) << 8) | at(i + 1)
  const u16le = (i: number) => at(i) | (at(i + 1) << 8)
  const u32be = (i: number) => at(i) * 2 ** 24 + (at(i + 1) << 16) + (at(i + 2) << 8) + at(i + 3)

  if (at(0) === 0x89 && at(1) === 0x50) return { width: u32be(16), height: u32be(20) } // PNG
  if (at(0) === 0x47 && at(1) === 0x49) return { width: u16le(6), height: u16le(8) } // GIF
  if (at(8) === 0x57 && at(9) === 0x45 && at(12) === 0x56 && at(15) === 0x58) {
    // WebP (VP8X): 24-bit sizes, stored minus one
    const u24le = (i: number) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16)
    return { width: 1 + u24le(24), height: 1 + u24le(27) }
  }
  if (at(0) === 0xff && at(1) === 0xd8) {
    // JPEG: walk the markers to the frame header (SOF0–SOF15, not DHT/JPG/DAC)
    let i = 2
    while (i + 9 < b.length) {
      if (at(i) !== 0xff) return undefined
      const marker = at(i + 1)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(i + 7), height: u16be(i + 5) }
      }
      i += 2 + u16be(i + 2)
    }
  }
  return undefined
}

/**
 * Tokens an image costs: width × height ÷ 750, after the API scales it down to
 * at most 1568 pixels on its long side and about 1.15 megapixels in all;
 * IMAGE_TOKENS_ESTIMATE when the size is unknown.
 */
export function imageTokens(block: ChatBlock): number {
  const source = block.source as { type?: string; data?: unknown } | undefined
  const size = source?.type === 'base64' && typeof source.data === 'string' ? imageSize(source.data) : undefined
  if (!size || size.width <= 0 || size.height <= 0) return IMAGE_TOKENS_ESTIMATE
  const scale = Math.min(1, 1568 / Math.max(size.width, size.height), Math.sqrt(1_150_000 / (size.width * size.height)))
  return Math.ceil((size.width * scale * size.height * scale) / 750)
}

/** The weight of whatever a block holds: text, a JSON input, nested blocks, media. */
function blockWeight(block: ChatBlock): number {
  switch (block.type) {
    case 'text':
      return textWeight(String(block.text ?? ''))
    case 'thinking':
      return textWeight(String(block.thinking ?? ''))
    case 'image':
      return imageTokens(block)
    case 'document':
      return IMAGE_TOKENS_ESTIMATE
    case 'tool_use':
    case 'server_tool_use':
      return textWeight(JSON.stringify(block.input ?? {}))
    case 'tool_result':
    case 'web_search_tool_result':
    case 'web_fetch_tool_result': {
      const content = block.content
      if (typeof content === 'string') return textWeight(content)
      if (Array.isArray(content)) return content.reduce((n, b) => n + blockWeight(b as ChatBlock), 0)
      return 0
    }
    default:
      return textWeight(JSON.stringify(block))
  }
}

/** Adds the weight of one block of a user message to the part it belongs to. */
function weighUserText(text: string, weights: MessageWeights) {
  const trimmed = text.trimStart()
  if (trimmed.startsWith(COMPACTION_SUMMARY_PREFIX)) {
    weights.claude += textWeight(text)
    return
  }
  if (AUTO_CONTEXT_PREFIXES.some(prefix => trimmed.startsWith(prefix))) {
    weights.auto += textWeight(text)
    return
  }
  // Your own text, with any reminders the engine appended taken out.
  const reminders = text.match(SYSTEM_REMINDER) ?? []
  const auto = reminders.reduce((n, r) => n + r.length, 0)
  weights.auto += auto / 4
  weights.you += (text.length - auto) / 4
}

const ASSIGNMENT = /^\$?[A-Za-z_][A-Za-z0-9_:]*=/

/** Whether a command sends output into a file (`> f`, `>> f`), so writes. */
function writesFile(command: string): boolean {
  const words = command.split(/\s+/)
  return words.some((word, i) => {
    const redirect = /^\d?>>?(.*)$/.exec(word)
    if (!redirect) return false
    const target = redirect[1] || words[i + 1] || ''
    return !/^(&\d|\/dev\/null|\$null|nul)$/i.test(target)
  })
}

/**
 * Whether a shell command only reads: its first program, past any leading
 * `cd dir`, `VAR=value` or `$Var = value` steps, is one of SHELL_READ_COMMANDS,
 * and nothing is written to a file with `>` or `>>`.
 */
export function isShellRead(command: string): boolean {
  const steps = command.trim().split(/\s*(?:&&|;|\n)\s*/)
  const first =
    steps
      .map(step => step.replace(/^(\$?[A-Za-z_][A-Za-z0-9_:]*)\s+=\s+/, '$1='))
      .find(step => {
        if (/^(cd|pushd|Set-Location)\b/i.test(step)) return false
        // A step of nothing but assignments sets up; the work comes after it.
        return !step.split(/\s+/).every(word => ASSIGNMENT.test(word))
      }) ?? ''
  const words = first.split(/\s+/).filter(word => !ASSIGNMENT.test(word))
  const program = words[0] ?? ''
  if (writesFile(command)) return false
  return SHELL_READ_COMMANDS.some(entry => {
    const [name, ...flags] = entry.split(' ')
    if (program.toLowerCase() !== name!.toLowerCase()) return false
    return flags.every(flag => words.slice(1).includes(flag))
  })
}

/** The part a tool call, and so its result, belongs to. */
export function toolPart(name: string, input: unknown): MessagePart {
  if (READ_TOOLS.includes(name)) return 'reads'
  if (EDIT_TOOLS.includes(name)) return 'edits'
  if (COMMAND_TOOLS.includes(name)) {
    const command = (input as { command?: unknown } | undefined)?.command
    return typeof command === 'string' && isShellRead(command) ? 'reads' : 'commands'
  }
  return 'otherTools'
}

/**
 * How much of the conversation each part holds, in rough tokens: what you
 * wrote, what Claude wrote, each kind of tool use, and context added for you.
 */
export function messageWeights(messages: readonly ChatMessage[]): MessageWeights {
  // Each call's part, by its id, so its result can follow it.
  const callParts = new Map<unknown, MessagePart>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        callParts.set(block.id, toolPart(String(block.name ?? ''), block.input))
      }
    }
  }

  const weights = noWeights()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        weights[callParts.get(block.id)!] += blockWeight(block)
      } else if (block.type === 'tool_result' || block.type.endsWith('_tool_result')) {
        weights[callParts.get(block.tool_use_id) ?? 'otherTools'] += blockWeight(block)
      } else if (message.role === 'assistant') {
        weights.claude += blockWeight(block)
      } else if (block.type === 'text') {
        weighUserText(String(block.text ?? ''), weights)
      } else {
        weights.you += blockWeight(block)
      }
    }
  }
  return weights
}

/**
 * `total` tokens shared out in proportion to `weights`, in whole tokens that
 * add up to exactly `total` (largest remainders get the leftovers).
 */
export function splitTokens(total: number, weights: MessageWeights): MessageWeights {
  const parts = Object.keys(weights) as MessagePart[]
  const sum = parts.reduce((n, p) => n + weights[p], 0)
  const out = noWeights()
  if (sum <= 0 || total <= 0) return out

  const exact = parts.map(p => ({ p, value: (weights[p] / sum) * total }))
  let given = 0
  for (const { p, value } of exact) {
    out[p] = Math.floor(value)
    given += out[p]
  }
  const byRemainder = [...exact].sort((a, b) => (b.value % 1) - (a.value % 1))
  for (let i = 0; i < total - given; i++) out[byRemainder[i % byRemainder.length]!.p] += 1
  return out
}

/**
 * The breakdown with its `Messages` row replaced by the parts, in its place
 * and in MESSAGE_PART_NAMES order; unchanged when there is no Messages row or
 * nothing to weigh.
 */
export function splitMessages(segments: readonly Segment[], messages: readonly ChatMessage[]): Segment[] {
  const index = segments.findIndex(s => s.name === 'Messages')
  if (index < 0) return [...segments]
  const row = segments[index]!
  const weights = messageWeights(messages)
  const tokens = splitTokens(row.tokens, weights)
  if (PARTS.every(p => tokens[p] === 0)) return [...segments]

  const parts = PARTS
    .filter(p => tokens[p] > 0)
    .map(p => ({ name: MESSAGE_PART_NAMES[p], tokens: tokens[p], color: row.color, kind: row.kind }))
  return [...segments.slice(0, index), ...parts, ...segments.slice(index + 1)]
}
