// Context bar: a band above the prompt with
//   - the context window, category by category, and a legend under it;
//   - the session (5-hour) and weekly usage limits, one thin bar each.
// /context-bar toggles the band; /context-bar context|session|weekly toggles
// one part, as do the small buttons at the end of the legend.
// Colours, sizes and defaults are in ./config.ts.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit, Show, Snapshot } from '../types'
import {
  APP_ZOOM,
  BAR_HEIGHT_PX,
  DEFAULT_SHOW,
  DISPLAY_SCALE,
  FREE_COLOR,
  LEGEND_GAP,
  LEGEND_MARKER,
  LIMIT_LABEL_WIDTH,
  LIMITS,
  PACE_COLOR,
  PACE_MARKER,
  SHOW_PROJECTION_WHEN_RED,
  SHOW_TOGGLE_BUTTONS,
  TERMINAL_GLYPHS,
  TERMINAL_TOGGLE_DOTS,
  TOGGLE_COLUMN_WIDTH,
  TOGGLE_CONTEXT_COLOR,
  TOGGLE_DOT_PX,
  TOGGLE_OFF_DOT_COLOR,
  TOGGLE_OFF_TEXT_COLOR,
  TOGGLE_ON_TEXT_COLOR,
  TOGGLE_RING_STROKE_PX,
} from './config'
import {
  barCells,
  barSegments,
  barSvg,
  colorOf,
  cssPx,
  dotSvg,
  elapsedShare,
  limitCells,
  limitColor,
  limitLabel,
  limitLevel,
  limitSvg,
  ordered,
  percent,
  projectedPercent,
  usedTokens,
  zoomFromConfig,
} from './layout'

const isOn = atom({ plugin: 'context-bar', key: 'isOn' } as const, true)
const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
const limits = atom({ plugin: 'context-bar', key: 'limits' } as const, [])
const show = atom({ plugin: 'context-bar', key: 'show' } as const, DEFAULT_SHOW)
const scale = atom({ plugin: 'context-bar', key: 'scale' } as const, 1)

const PARTS = ['context', 'session', 'weekly'] as const
type Part = (typeof PARTS)[number]
const PART_LABELS: Record<Part, string> = { context: 'Context', session: 'Session', weekly: 'Weekly' }

// ── Data ────────────────────────────────────────────────────────────────────

/** Keeps the latest rate-limit readings. */
async function storeLimits($: any, next: readonly Limit[]) {
  await update($, limits, () => next.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })))
}

/** Reads the window's breakdown and the limits, and stores them for the next draw. */
async function refresh($: any) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  await storeLimits($, usage.rateLimits ?? [])

  const breakdown = usage.context.breakdown
  if (!breakdown) return
  const next: Snapshot = {
    window: breakdown.rawMaxTokens,
    segments: breakdown.categories
      .filter((c: any) => c.kind !== 'deferred' && c.tokens > 0)
      .map((c: any) => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
  }
  await update($, snapshot, () => next)
}

/**
 * Screen pixels per CSS pixel in the desktop app: its zoom, read from its
 * config.json unless APP_ZOOM sets it, times the display scaling.
 */
async function readScale($: any): Promise<number> {
  if (typeof APP_ZOOM === 'number') return APP_ZOOM * DISPLAY_SCALE
  const appData = await $.env.get('APPDATA')
  const home = await $.env.get('HOME')
  const paths = [
    appData && `${appData}/Claude/config.json`, // Windows
    home && `${home}/Library/Application Support/Claude/config.json`, // macOS
  ].filter(Boolean) as string[]
  for (const path of paths) {
    const text = await $.fs.read(path).catch(() => undefined)
    if (text) return zoomFromConfig(text) * DISPLAY_SCALE
  }
  return DISPLAY_SCALE
}

/** Shows or hides one part, and remembers the choice across sessions. */
async function togglePart($: any, part: Part) {
  const current = await read($, show)
  const next: Show = { ...current, [part]: !current[part] }
  await update($, show, () => next)
  // Remembering is a convenience: the toggle stands even if saving fails.
  await $.store.set('show', next).catch(() => {})
  return next[part]
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-bar',
      description: 'Toggle the context bar, or one part: context, session, weekly',
    })
    const saved = (await $.store.get('show').catch(() => undefined)) as Partial<Show> | undefined
    await update($, show, () => ({ ...DEFAULT_SHOW, ...saved }))
    const screenScale = await readScale($)
    await update($, scale, () => screenScale)
    await refresh($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    // The zoom can change mid-session (Ctrl + / Ctrl -).
    const screenScale = await readScale($)
    await update($, scale, () => screenScale)

    return next(e)
  })

  // Limits move between turns too (other sessions use the same allowance).
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await storeLimits($, e.rateLimits)

    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === '') {
      const now = !(await read($, isOn))
      await update($, isOn, () => now)
      if (now) await refresh($)
      return { text: `Context bar ${now ? 'on' : 'off'}.` }
    }

    const part = PARTS.find(p => p === arg)
    if (!part) {
      return { text: `Usage: /context-bar [${PARTS.join('|')}]` }
    }
    const shown = await togglePart($, part)
    return { text: `${PART_LABELS[part]} ${shown ? 'shown' : 'hidden'}.` }
  })

  // ── Drawing ─────────────────────────────────────────────────────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // The terminal has no vector drawing; it gets text bars and dots instead.
    const isVector = e.surface !== 'terminal' && 'Svg' in els
    const width = Math.max(10, e.props.bodyColumns ?? (e.viewport?.columns ?? 80) - 2)

    const visible = await read($, show)
    const snap = await read($, snapshot)
    const readings = await read($, limits)
    const now = await $.clock.now()
    const pxScale = await read($, scale)

    // The toggle buttons, kept in the bottom-right corner: a filled dot in
    // the part's colour when on, a hollow grey ring and softer text when off.
    // The dot sits beside the button, whose label takes the press; in the
    // desktop app it is drawn, so filled and hollow match in size.
    const dotColor = (part: Part) => {
      if (part === 'context') return TOGGLE_CONTEXT_COLOR
      const def = LIMITS.find(l => l.key === part)
      const limit = readings.find(l => l.kind === def?.kind)
      if (!def || !limit) return limitColor(0, undefined)
      return limitColor(limit.percentUsed, elapsedShare(limit.resetsAt, def.hours, now))
    }
    const toggle = (part: Part) => {
      const isShown = visible[part]
      const color = isShown ? dotColor(part) : TOGGLE_OFF_DOT_COLOR
      const dotSize = cssPx(TOGGLE_DOT_PX, pxScale)
      const dot = isVector ? (
        <els.Svg
          source={dotSvg(color, isShown, TOGGLE_DOT_PX, TOGGLE_RING_STROKE_PX, dotSize)}
          width={dotSize}
          height={dotSize}
          alt={`${PART_LABELS[part]} ${isShown ? 'on' : 'off'}`}
        />
      ) : (
        <Text color={color}>{isShown ? TERMINAL_TOGGLE_DOTS.on : TERMINAL_TOGGLE_DOTS.off}</Text>
      )
      return (
        <Box key={`toggle-${part}-box`} flexDirection="row" alignItems="center" columnGap={1}>
          {dot}
          <Button key={`toggle-${part}`} plain onPress={() => void togglePart($, part)}>
            <Text color={isShown ? TOGGLE_ON_TEXT_COLOR : TOGGLE_OFF_TEXT_COLOR}>{PART_LABELS[part]}</Text>
          </Button>
        </Box>
      )
    }
    const toggles = SHOW_TOGGLE_BUTTONS ? (
      <Box key="toggles" width={TOGGLE_COLUMN_WIDTH} flexShrink={0} flexDirection="row" justifyContent="flex-end" columnGap={LEGEND_GAP}>
        {PARTS.map(toggle)}
      </Box>
    ) : null

    const rows = []

    // Context window: the stacked bar and its legend.
    if (visible.context && snap && snap.window > 0) {
      const segments = ordered(snap.segments)
      const filled = barSegments(segments, snap.window)

      if (isVector) {
        rows.push(
          <els.Svg
            key="context-bar"
            source={barSvg(filled, snap.window)}
            height={BAR_HEIGHT_PX}
            alt={`Context window ${percent(usedTokens(segments), snap.window)}% used`}
          />,
        )
      } else {
        const { cells, free } = barCells(filled, snap.window, width)
        rows.push(
          <Box key="context-bar">
            {cells.map(({ segment, count }, i) =>
              count > 0 ? (
                <Text key={`bar-${i}`} color={colorOf(segment)} wrap="truncate">
                  {(segment.kind === 'buffer' ? TERMINAL_GLYPHS.reserve : TERMINAL_GLYPHS.used).repeat(count)}
                </Text>
              ) : null,
            )}
            {free > 0 ? (
              <Text key="bar-free" color={FREE_COLOR} wrap="truncate">
                {TERMINAL_GLYPHS.free.repeat(free)}
              </Text>
            ) : null}
          </Box>,
        )
      }

      // Every category, in the bar's order; each entry stays on one line.
      rows.push(
        <Box key="legend" flexDirection="row" flexWrap="wrap" columnGap={LEGEND_GAP}>
          {segments.map((s, i) => {
            const label = `${s.name} ${percent(s.tokens, snap.window)}%`
            return (
              <Box key={`legend-${i}`} flexShrink={0}>
                <Text wrap="truncate">
                  <Text color={colorOf(s)}>{LEGEND_MARKER}</Text>{' '}
                  {s.kind === 'free' ? <Text dimColor>{label}</Text> : <Text color={colorOf(s)}>{label}</Text>}
                </Text>
              </Box>
            )
          })}
        </Box>,
      )
    }

    // Usage limits: one thin row each, label in front. The last one shares
    // its row with the buttons, at the right.
    const shownLimits = LIMITS.filter(def => visible[def.key] && readings.some(l => l.kind === def.kind))
    shownLimits.forEach((def, index) => {
      const isLast = index === shownLimits.length - 1
      const limit = readings.find(l => l.kind === def.kind)!

      // Colour by where the current pace leads; when that is red, the label
      // says where: `◷ Session 48% → 240%`.
      const elapsed = elapsedShare(limit.resetsAt, def.hours, now)
      const isRed = limitLevel(limit.percentUsed, elapsed) === 'danger'
      const projected = SHOW_PROJECTION_WHEN_RED && isRed ? projectedPercent(limit.percentUsed, elapsed) : undefined
      const label = limitLabel(def.icon, def.label, limit, now, projected)
      const color = limitColor(limit.percentUsed, elapsed)
      const pace = PACE_MARKER ? elapsed : undefined

      let bar
      if (isVector) {
        const height = cssPx(def.heightPx, pxScale)
        bar = (
          <els.Svg
            source={limitSvg(limit.percentUsed, color, def.divisions, height, pace)}
            height={height}
            alt={`${def.label} limit ${Math.round(limit.percentUsed)}% used`}
          />
        )
      } else {
        // Terminal: used cells, free cells, and the pace marker drawn over
        // whichever cell it falls on.
        const reserved = SHOW_TOGGLE_BUTTONS && isLast ? TOGGLE_COLUMN_WIDTH + 1 : 0
        const barWidth = Math.max(10, width - LIMIT_LABEL_WIDTH - 1 - reserved)
        const { used, paceAt } = limitCells(limit.percentUsed, barWidth, pace)
        const cell = (i: number) =>
          i === paceAt
            ? <Text key={`c${i}`} color={PACE_COLOR}>{TERMINAL_GLYPHS.pace}</Text>
            : <Text key={`c${i}`} color={i < used ? color : FREE_COLOR}>{i < used ? TERMINAL_GLYPHS.used : TERMINAL_GLYPHS.free}</Text>
        bar = <Text wrap="truncate">{Array.from({ length: barWidth }, (_, i) => cell(i))}</Text>
      }

      rows.push(
        <Box key={`limit-${def.key}`} flexDirection="row" alignItems="center" columnGap={1}>
          <Box width={LIMIT_LABEL_WIDTH} flexShrink={0}>
            <Text color={color} wrap="truncate">{label}</Text>
          </Box>
          <Box width={0} flexGrow={1}>{bar}</Box>
          {isLast ? toggles : null}
        </Box>,
      )
    })

    // With no limit row to share, the buttons take a row of their own, still
    // at the bottom right.
    if (shownLimits.length === 0 && toggles) {
      rows.push(
        <Box key="toggles-row" flexDirection="row" justifyContent="flex-end">
          {toggles}
        </Box>,
      )
    }

    if (rows.length === 0) return next(e)

    return <Box flexDirection="column">{rows}</Box>
  })
}
