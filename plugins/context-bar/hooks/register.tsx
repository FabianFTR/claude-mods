// Context bar: a band above the prompt with
//   - the context window, category by category, and a legend under it, with
//     the conversation split into your messages, Claude's replies, tools and
//     auto context; hover a part of the bar for its tokens;
//   - the session (5-hour) and weekly usage limits, one thin bar each.
// /context-bar toggles the band; /context-bar context|session|weekly toggles
// one part, as do the small buttons in the bottom-right corner. Clicking a
// category in the legend moves it into Other, and back. Short notices warn
// when the context fills up or a limit turns red.
// Colours, sizes and defaults are in ./config.ts.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit, Segment, Show, Snapshot } from '../types'
import {
  ALERT_ON_LIMIT_RED,
  ALERT_TOAST_MS,
  ALERTS,
  APP_ZOOM,
  BAR_HEIGHT_PX,
  BAR_TOOLTIPS,
  CLOCK_TICK_MS,
  CONTEXT_ALERT_AT,
  DEFAULT_HIDDEN,
  DEFAULT_SHOW,
  DISPLAY_SCALE,
  LEGEND_GAP,
  LEGEND_MARKER,
  LIMIT_LABEL_WIDTH,
  LIMITS,
  MIN_VISIBLE_SHARE,
  OTHER_NAME,
  PACE_MARKER,
  SHOW_COST,
  SHOW_GROWTH,
  SHOW_PROJECTION_WHEN_RED,
  SHOW_TOGGLE_BUTTONS,
  SPLIT_MESSAGES,
  TERMINAL_GLYPHS,
  TERMINAL_TOGGLE_DOTS,
  THEME,
  TOGGLE_COLUMN_WIDTH,
  TOGGLE_CONTEXT_COLOR,
  TOGGLE_DOT_PX,
  TOGGLE_RING_STROKE_PX,
} from './config'
import {
  alertStep,
  barCells,
  barSegments,
  barSvg,
  colorOf,
  colors,
  contextFullPercent,
  costLabel,
  cssPx,
  dotSvg,
  elapsedShare,
  formatTokens,
  groupSegments,
  growthLabel,
  limitCells,
  limitColor,
  limitLabel,
  limitLevel,
  limitSvg,
  percent,
  projectedPercent,
  splitMessages,
  themeFromSystem,
  timeUntil,
  useTheme,
  usedTokens,
  zoomFromConfig,
} from './layout'
import type { ChatMessage, Theme } from './layout'

const isOn = atom({ plugin: 'context-bar', key: 'isOn' } as const, true)
const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
const limits = atom({ plugin: 'context-bar', key: 'limits' } as const, [])
const show = atom({ plugin: 'context-bar', key: 'show' } as const, DEFAULT_SHOW)
const hidden = atom({ plugin: 'context-bar', key: 'hidden' } as const, DEFAULT_HIDDEN)
const otherOpen = atom({ plugin: 'context-bar', key: 'otherOpen' } as const, false)
const scale = atom({ plugin: 'context-bar', key: 'scale' } as const, 1)
const theme = atom({ plugin: 'context-bar', key: 'theme' } as const, 'dark')
const lastUsed = atom({ plugin: 'context-bar', key: 'lastUsed' } as const, null)
const lastDelta = atom({ plugin: 'context-bar', key: 'lastDelta' } as const, null)
const cost = atom({ plugin: 'context-bar', key: 'cost' } as const, null)
const alerted = atom({ plugin: 'context-bar', key: 'alerted' } as const, {})

const PARTS = ['context', 'session', 'weekly'] as const
type Part = (typeof PARTS)[number]
const PART_LABELS: Record<Part, string> = { context: 'Context', session: 'Session', weekly: 'Weekly' }

// ── Data ────────────────────────────────────────────────────────────────────

/** Keeps the latest rate-limit readings, and warns when one turns red. */
async function storeLimits($: any, next: readonly Limit[]) {
  await update($, limits, () => next.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })))
  if (ALERTS && ALERT_ON_LIMIT_RED) await alertLimits($, next)
}

/**
 * Reads the window's breakdown, the limits and the cost, and stores them for
 * the next draw. After a reply, also what that reply added to the context.
 */
async function refresh($: any, afterReply = false) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  await storeLimits($, usage.rateLimits ?? [])
  await update($, cost, () => (typeof usage.cost?.usd === 'number' ? usage.cost.usd : null))

  const breakdown = usage.context.breakdown
  if (!breakdown) return
  const segments: Segment[] = breakdown.categories
    .filter((c: any) => c.kind !== 'deferred' && c.tokens > 0)
    .map((c: any) => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind }))

  const next: Snapshot = {
    window: breakdown.rawMaxTokens,
    segments: SPLIT_MESSAGES ? splitMessages(segments, await readConversation($)) : segments,
  }
  await update($, snapshot, () => next)

  // Growth: the context in use now against after the reply before.
  const used = usedTokens(next.segments)
  const before = await read($, lastUsed)
  if (afterReply && before !== null) await update($, lastDelta, () => used - before)
  await update($, lastUsed, () => used)

  if (ALERTS) await alertContext($, next)
}

/** The conversation in Messages API form; empty when it cannot be read. */
async function readConversation($: any): Promise<ChatMessage[]> {
  const messages = await $.session.messages({ as: 'api' }).catch(() => [])
  return Array.isArray(messages) ? messages : []
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

/** The theme the colours follow: THEME, or with 'auto' the system's. */
async function readTheme($: any): Promise<Theme> {
  if (THEME !== 'auto') return THEME
  const output = async (argv: string[]) =>
    $.process.run(argv, { timeoutMs: 5000 }).then((r: any) => String(r.stdout ?? '')).catch(() => undefined)
  if (await $.env.get('APPDATA')) {
    const windows = await output(['reg', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'])
    if (windows) return themeFromSystem({ windows })
  }
  const mac = await output(['defaults', 'read', '-g', 'AppleInterfaceStyle'])
  return mac === undefined ? 'dark' : themeFromSystem({ mac })
}

/** Reads the zoom and the theme, which can change mid-session. */
async function readSurroundings($: any) {
  const [screenScale, systemTheme] = await Promise.all([readScale($), readTheme($)])
  await update($, scale, () => screenScale)
  await update($, theme, () => systemTheme)
}

// ── Alerts ──────────────────────────────────────────────────────────────────

/** Notes that an alert was raised (or cleared), and shows it when it is new. */
async function alertOnce($: any, key: string, step: { raise: boolean; alerted: boolean }, text: () => string) {
  const current = await read($, alerted)
  if (current[key] !== step.alerted) await update($, alerted, a => ({ ...a, [key]: step.alerted }))
  if (step.raise) $.ui.toast(text(), { timeoutMs: ALERT_TOAST_MS })
}

/** Warns once when the context window passes CONTEXT_ALERT_AT. */
async function alertContext($: any, snap: Snapshot) {
  const full = contextFullPercent(snap.segments, snap.window)
  const step = alertStep(full, CONTEXT_ALERT_AT, (await read($, alerted)).context ?? false)
  const free = snap.segments.find(s => s.kind === 'free')?.tokens ?? 0
  await alertOnce($, 'context', step, () => `Context ${Math.round(full)}% full: ${formatTokens(free)} left before it compacts.`)
}

/** Warns once when a usage limit turns red. */
async function alertLimits($: any, readings: readonly Limit[]) {
  const now = await $.clock.now()
  const was = await read($, alerted)
  for (const def of LIMITS) {
    const limit = readings.find(l => l.kind === def.kind)
    if (!limit) continue
    const isRed = limitLevel(limit.percentUsed, elapsedShare(limit.resetsAt, def.hours, now)) === 'danger'
    const step = alertStep(isRed ? 1 : 0, 1, was[def.kind] ?? false, 1)
    const left = timeUntil(limit.resetsAt, now)
    await alertOnce($, def.kind, step, () =>
      `${def.label} limit ${Math.round(limit.percentUsed)}%: at this pace it runs out before it resets${left ? ` (in ${left})` : ''}.`,
    )
  }
}

// ── Choices ─────────────────────────────────────────────────────────────────

/**
 * Moves a category into Other or back out of it, and remembers the choice
 * across sessions. Returns whether it is now hidden.
 */
async function setHidden($: any, name: string, hide: boolean) {
  const current = await read($, hidden)
  const next = hide ? [...new Set([...current, name])] : current.filter(n => n !== name)
  await update($, hidden, () => next)
  await $.store.set('hidden', next).catch(() => {})
  return hide
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
    const savedHidden = await $.store.get('hidden').catch(() => undefined)
    if (Array.isArray(savedHidden)) await update($, hidden, () => savedHidden.filter(n => typeof n === 'string'))
    await readSurroundings($)
    await refresh($)

    // Redraw on a clock, so "resets in" stays current between replies.
    $.clock.every(CLOCK_TICK_MS, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($, true)
    await readSurroundings($)

    return next(e)
  })

  // Limits move between turns too (other sessions use the same allowance).
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await storeLimits($, e.rateLimits)

    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase().replace(/\s+/g, ' ')

    if (arg === '') {
      const now = !(await read($, isOn))
      await update($, isOn, () => now)
      if (now) await refresh($)
      return { text: `Context bar ${now ? 'on' : 'off'}.` }
    }

    // /context-bar hide <category>, /context-bar unhide <category|all>
    const hideMatch = /^(hide|unhide)\s+(.+)$/.exec(arg)
    if (hideMatch) {
      const [, verb, wanted] = hideMatch
      if (verb === 'unhide' && wanted === 'all') {
        await update($, hidden, () => [])
        await $.store.set('hidden', []).catch(() => {})
        return { text: 'Every category is back in the legend.' }
      }
      const snap = await read($, snapshot)
      const name = snap?.segments.find(s => s.kind !== 'free' && s.name.toLowerCase() === wanted)?.name
      if (!name) return { text: `No category called "${wanted}" right now.` }
      await setHidden($, name, verb === 'hide')
      return { text: `${name} ${verb === 'hide' ? 'moved into' : 'taken out of'} ${OTHER_NAME}.` }
    }

    const part = PARTS.find(p => p === arg)
    if (!part) {
      return { text: `Usage: /context-bar [${PARTS.join('|')}], or /context-bar hide|unhide <category>` }
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

    useTheme(await read($, theme))
    const palette = colors()
    const visible = await read($, show)
    const hiddenNames = await read($, hidden)
    const isOtherOpen = await read($, otherOpen)
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
      const color = isShown ? dotColor(part) : palette.toggleOffDot
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
            <Text color={isShown ? palette.toggleOnText : palette.toggleOffText}>{PART_LABELS[part]}</Text>
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
      const grouped = groupSegments(snap.segments, snap.window, hiddenNames)
      const { segments, inOther } = grouped
      const filled = barSegments(grouped)

      if (isVector) {
        rows.push(
          <els.Svg
            key="context-bar"
            source={barSvg(filled, snap.window, BAR_TOOLTIPS)}
            height={BAR_HEIGHT_PX}
            isInteractive={BAR_TOOLTIPS || undefined}
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
              <Text key="bar-free" color={palette.free} wrap="truncate">
                {TERMINAL_GLYPHS.free.repeat(free)}
              </Text>
            ) : null}
          </Box>,
        )
      }

      // One legend entry: its square, then its name and share. A press on a
      // category moves it into Other; on Other, opens the list of what it holds.
      const entry = (s: Segment, key: string, onPress?: () => void, note = '') => {
        const label = `${s.name} ${percent(s.tokens, snap.window)}%${note}`
        const text = s.kind === 'free' || !onPress ? <Text dimColor>{label}</Text> : <Text color={colorOf(s)}>{label}</Text>
        return (
          <Box key={key} flexDirection="row" flexShrink={0} columnGap={1}>
            <Text color={colorOf(s)}>{LEGEND_MARKER}</Text>
            {onPress ? (
              <Button key={`${key}-press`} plain onPress={onPress}>
                {text}
              </Button>
            ) : (
              <Text wrap="truncate">{text}</Text>
            )}
          </Box>
        )
      }

      // After the categories: what the last reply added, and the cost.
      const info = [
        SHOW_GROWTH ? growthLabel(await read($, lastDelta)) : '',
        costLabel(await read($, cost), SHOW_COST, readings.length > 0),
      ].filter(Boolean)

      // Every category, in the bar's order; each entry stays on one line.
      rows.push(
        <Box key="legend" flexDirection="row" flexWrap="wrap" columnGap={LEGEND_GAP}>
          {segments.map(s => {
            if (s.kind === 'free') return entry(s, 'legend-free')
            if (s.kind === 'other') {
              const toggleOther = () => void update($, otherOpen, open => !open)
              return entry(s, 'legend-other', toggleOther, isOtherOpen ? ' ▾' : ' ▸')
            }
            return entry(s, `legend-${s.name}`, () => void setHidden($, s.name, true))
          })}
          {info.length > 0 ? (
            <Text key="legend-info" dimColor wrap="truncate">
              {`│ ${info.join(' · ')}`}
            </Text>
          ) : null}
        </Box>,
      )

      // What Other holds, when open: a hidden category comes back on a press;
      // one under the threshold stays until it grows past it.
      if (isOtherOpen && inOther.length > 0) {
        rows.push(
          <Box key="other-list" flexDirection="row" flexWrap="wrap" columnGap={LEGEND_GAP}>
            <Text dimColor>{OTHER_NAME}:</Text>
            {inOther.map(s =>
              hiddenNames.includes(s.name)
                ? entry(s, `other-${s.name}`, () => void setHidden($, s.name, false))
                : entry(s, `other-${s.name}`, undefined, ` (under ${MIN_VISIBLE_SHARE * 100}%)`),
            )}
          </Box>,
        )
      }
    }

    // Usage limits: one thin row each, label in front. The last one shares
    // its row with the buttons, at the right.
    const shownLimits = LIMITS.filter(def => visible[def.key] && readings.some(l => l.kind === def.kind))
    shownLimits.forEach((def, index) => {
      const isLast = index === shownLimits.length - 1
      const limit = readings.find(l => l.kind === def.kind)!

      // Colour by where the current pace leads; when that is red, the label
      // can say where: `◷ Session 48% → 240%`.
      const elapsed = elapsedShare(limit.resetsAt, def.hours, now)
      const isRed = limitLevel(limit.percentUsed, elapsed) === 'danger'
      const projected = SHOW_PROJECTION_WHEN_RED && isRed ? projectedPercent(limit.percentUsed, elapsed) : undefined
      const label = limitLabel(def.icon, def.label, limit, now, projected)
      const color = limitColor(limit.percentUsed, elapsed)
      const pace = PACE_MARKER ? elapsed : undefined

      let bar
      if (isVector) {
        const height = cssPx(def.heightPx, pxScale)
        const left = timeUntil(limit.resetsAt, now)
        const title = BAR_TOOLTIPS ? `${def.label}: ${Math.round(limit.percentUsed)}% used${left ? `, resets in ${left}` : ''}` : undefined
        bar = (
          <els.Svg
            source={limitSvg(limit.percentUsed, color, def.divisions, height, pace, title)}
            height={height}
            isInteractive={BAR_TOOLTIPS || undefined}
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
            ? <Text key={`c${i}`} color={palette.pace}>{TERMINAL_GLYPHS.pace}</Text>
            : <Text key={`c${i}`} color={i < used ? color : palette.free}>{i < used ? TERMINAL_GLYPHS.used : TERMINAL_GLYPHS.free}</Text>
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
