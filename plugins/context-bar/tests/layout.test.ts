import { describe, expect, test } from 'claude-code/testing'

import type { Segment } from '../types'
import { CATEGORY_COLORS, FREE_COLOR, LIMIT_COLORS, LIMITS, TOGGLE_DOT_PX } from '../hooks/config'
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
  timeUntil,
  zoomFromConfig,
} from '../hooks/layout'

const WINDOW = 200_000
const seg = (name: string, tokens: number, kind = 'used'): Segment => ({ name, tokens, kind, color: '' })

// As /context lists it: used categories, then free space, then the reserve.
const BREAKDOWN: Segment[] = [
  seg('System prompt', 800), // 0.4%: legend only
  seg('System tools', 6_800),
  seg('Messages', 26_800),
  seg('Free space', 159_000, 'free'),
  seg('Autocompact buffer', 6_600, 'buffer'),
]

describe('order', () => {
  test('reserve first, used in /context order, free last', () => {
    expect(ordered(BREAKDOWN).map(s => s.name)).toEqual([
      'Autocompact buffer',
      'System prompt',
      'System tools',
      'Messages',
      'Free space',
    ])
  })
})

describe('bar', () => {
  test('a segment under 1% is legend-only', () => {
    const names = barSegments(ordered(BREAKDOWN), WINDOW).map(s => s.name)
    expect(names).toEqual(['Autocompact buffer', 'System tools', 'Messages'])
  })

  test('exactly 1% is drawn', () => {
    expect(barSegments([seg('Skills', 2_000)], WINDOW)).toHaveLength(1)
  })

  test('the SVG lays segments edge to edge at exact widths', () => {
    const svg = barSvg(barSegments(ordered(BREAKDOWN), WINDOW), WINDOW)
    expect(svg).toContain('x="0.000" y="0" width="33.000"') // reserve, 3.3%
    expect(svg).toContain('x="33.000" y="0" width="34.000"') // System tools, 3.4%
    expect(svg).toContain('x="67.000" y="0" width="134.000"') // Messages, 13.4%
  })

  test('terminal cells add up to the full width', () => {
    const { cells, free } = barCells(barSegments(ordered(BREAKDOWN), WINDOW), WINDOW, 60)
    expect(cells.reduce((n, c) => n + c.count, 0) + free).toBe(60)
  })
})

describe('colours', () => {
  test('bar and legend take the colour from config', () => {
    expect(colorOf(seg('Messages', 1))).toBe(CATEGORY_COLORS.Messages)
    expect(colorOf(seg('Free space', 1, 'free'))).toBe(FREE_COLOR)
  })

  test('percent has one decimal', () => {
    expect(percent(800, WINDOW)).toBe('0.4')
  })
})

describe('usage limits', () => {
  const NOW = Date.parse('2026-10-13T10:00:00Z')

  describe('colour by projection', () => {
    test('projection is the share used over the share of time passed', () => {
      expect(projectedPercent(48, 0.2)).toBe(240)
      expect(projectedPercent(30, 0.5)).toBe(60)
    })

    test('green while the pace leads comfortably to the reset', () => {
      expect(limitLevel(30, 0.5)).toBe('ok') // → 60%
      expect(limitLevel(42, 0.5)).toBe('ok') // → 84%
    })

    test('yellow when the pace leads close to the limit', () => {
      expect(limitLevel(43, 0.5)).toBe('warn') // → 86%
      expect(limitLevel(54, 0.5)).toBe('warn') // → 108%
    })

    test('red when the pace runs out before the reset', () => {
      expect(limitLevel(48, 0.2)).toBe('danger') // → 240%, the example
      expect(limitLevel(55, 0.5)).toBe('danger') // → 110%
    })

    test('red at 90% used, whatever the pace', () => {
      expect(limitLevel(90, 0.99)).toBe('danger') // → 91%, still red
    })

    test('a low share used late in the window stays green', () => {
      expect(limitLevel(70, 0.95)).toBe('ok') // → 74%
    })

    test('early in the window: share used alone', () => {
      expect(projectedPercent(5, 0.05)).toBeUndefined()
      expect(limitLevel(5, 0.05)).toBe('ok') // would project 100%
      expect(limitLevel(70, 0.05)).toBe('warn')
      expect(limitLevel(92, 0.05)).toBe('danger')
    })

    test('without a reset time: share used alone', () => {
      expect(limitLevel(50, undefined)).toBe('ok')
      expect(limitLevel(70, undefined)).toBe('warn')
    })

    test('the colour is the colour of the level, from config', () => {
      expect(limitColor(48, 0.2)).toBe(LIMIT_COLORS.danger)
      expect(limitColor(30, 0.5)).toBe(LIMIT_COLORS.ok)
    })
  })

  test('label shows the projection when one is given', () => {
    const limit = { kind: 'five_hour', percentUsed: 48, resetsAt: '2026-10-13T12:10:00Z' }
    expect(limitLabel('◷', 'Session', limit, NOW, 240)).toBe('◷ Session 48% → 240% · 2h 10m')
    expect(limitLabel('◷', 'Session', limit, NOW, 5000)).toBe('◷ Session 48% → 999% · 2h 10m')
  })

  test('label shows the share and the time to reset', () => {
    const limit = { kind: 'five_hour', percentUsed: 42.4, resetsAt: '2026-10-13T12:10:00Z' }
    expect(limitLabel('◷', 'Session', limit, NOW)).toBe('◷ Session 42% · 2h 10m')
  })

  test('days once the reset is a day or more away', () => {
    expect(timeUntil('2026-10-16T09:00:00Z', NOW)).toBe('2d 23h')
  })

  test('no time once the reset has passed', () => {
    expect(timeUntil('2026-10-13T09:00:00Z', NOW)).toBe('')
  })

  test('terminal cells add up to the full width', () => {
    const { used, free } = limitCells(42, 50)
    expect(used + free).toBe(50)
  })

  test('pace: share of the window already passed', () => {
    // Resets in 2h30m of a 5h window: half has passed.
    expect(elapsedShare('2026-10-13T12:30:00Z', 5, NOW)).toBe(0.5)
    expect(elapsedShare(undefined, 5, NOW)).toBeUndefined()
  })

  test('the SVG has one divider fewer than divisions, and the pace line', () => {
    const svg = limitSvg(40, '#fff', 7, 3, 0.5)
    expect(svg.match(/<line /g)).toHaveLength(6 + 1)
    expect(svg).toContain('x1="500.000"')
  })

  test('thick and thin bars are drawn at the same width', () => {
    const width = (svg: string) => svg.match(/<svg [^>]*width="([0-9]+)"/)![1]
    expect(width(limitSvg(40, '#fff', 5, 6))).toBe(width(limitSvg(40, '#fff', 7, 3)))
  })

  test('no pace line without a reset time', () => {
    expect(limitSvg(40, '#fff', 5, 6).match(/<line /g)).toHaveLength(4)
  })
})

describe('toggle dots', () => {
  test('filled and hollow dots have the same size', () => {
    const size = (svg: string) => svg.match(/<svg [^>]*width="([0-9.]+)" height="([0-9.]+)"/)!.slice(1)
    expect(size(dotSvg('#fff', true, 7, 1.2))).toEqual(size(dotSvg('#fff', false, 7, 1.2)))
  })

  test('the hollow dot is a ring that ends at the same outer edge', () => {
    const ring = dotSvg('#fff', false, 7, 1.2)
    expect(ring).toContain('fill="none"')
    expect(ring).toContain('r="2.9"') // 3.5 outer radius less half the stroke
  })

  test('drawn at the size given, with its shape in screen pixels', () => {
    const dot = dotSvg('#fff', true, 7, 1.25, 7.668)
    expect(dot).toContain('width="7.668" height="7.668" viewBox="0 0 7 7"')
  })
})

describe('screen scale', () => {
  // How the app places a drawn bar, as Chromium does with its zoom: lengths
  // are zoomed, held in 1/64ths of a pixel, then each edge snaps to the
  // nearest screen pixel, so the height on screen depends on where it starts.
  const units = (px: number) => Math.round(px * 64) / 64
  const onScreen = (top: number, cssHeight: number, scale: number) => {
    const y = units(top * scale)
    return Math.round(y + units(cssHeight * scale)) - Math.round(y)
  }
  // Start positions across 60 CSS pixels, at an uneven step so they sample
  // every part of a pixel.
  const tops = Array.from({ length: 6000 }, (_, i) => i * Math.SQRT2 / 141)
  const heightsAt = (cssHeight: number, scale: number) =>
    new Set(tops.map(top => onScreen(top, cssHeight, scale)))

  const ZOOM = 1.2 ** -0.5 // the app's zoom level -0.5, as on this machine

  test('reads the zoom from the app config', () => {
    expect(Math.abs(zoomFromConfig('{"windowControlsZoomFactor":0.9128709291752769}') - ZOOM)).toBeLessThan(1e-9)
    expect(zoomFromConfig('{}')).toBe(1)
    expect(zoomFromConfig('not json')).toBe(1)
    expect(zoomFromConfig(undefined)).toBe(1)
  })

  test('the bug: 6 CSS pixels at this zoom come out 5 or 6 screen pixels', () => {
    expect([...heightsAt(6, ZOOM)].sort()).toEqual([5, 6])
  })

  for (const zoom of [ZOOM, 0.8, 0.9, 1, 1.1, 1.25, 1.5]) {
    for (const px of [3, 5, 6, 8]) {
      test(`${px} screen px at zoom ${zoom.toFixed(3)} is ${px} wherever the bar falls`, () => {
        expect([...heightsAt(cssPx(px, zoom), zoom)]).toEqual([px])
      })
    }
  }

  test('the dot bug: 7 CSS pixels at this zoom come out 6 or 7 a side, so ovals', () => {
    expect([...heightsAt(7, ZOOM)].sort()).toEqual([6, 7])
  })

  test('a dot sized in screen pixels is round wherever it sits', () => {
    const size = cssPx(TOGGLE_DOT_PX, ZOOM)
    // Width and height snap independently; both must come out the same.
    expect([...heightsAt(size, ZOOM)]).toEqual([TOGGLE_DOT_PX])
  })

  test('session and weekly get the same height', () => {
    const [session, weekly] = LIMITS.map(l => cssPx(l.heightPx, ZOOM))
    expect(session).toBe(weekly)
  })
})
