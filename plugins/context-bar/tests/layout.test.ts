import { describe, expect, test } from 'claude-code/testing'

import type { Segment } from '../types'
import {
  CATEGORY_COLORS,
  COMPACTION_SUMMARY_PREFIX,
  FREE_COLOR,
  IMAGE_TOKENS_ESTIMATE,
  LIMIT_COLORS,
  LIMITS,
  MESSAGE_PART_NAMES,
  TOGGLE_DOT_PX,
} from '../hooks/config'
import {
  barCells,
  barSegments,
  barSvg,
  colorOf,
  cssPx,
  dotSvg,
  elapsedShare,
  imageSize,
  imageTokens,
  isShellRead,
  limitCells,
  limitColor,
  limitLabel,
  limitLevel,
  limitSvg,
  messageWeights,
  ordered,
  percent,
  projectedPercent,
  splitMessages,
  splitTokens,
  timeUntil,
  toolPart,
  zoomFromConfig,
} from '../hooks/layout'
import type { ChatBlock, ChatMessage } from '../hooks/layout'

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

describe('messages split', () => {
  const user = (...content: ChatBlock[]): ChatMessage => ({ role: 'user', content })
  const assistant = (...content: ChatBlock[]): ChatMessage => ({ role: 'assistant', content })
  const text = (t: string): ChatBlock => ({ type: 'text', text: t })
  const x = (n: number) => 'x'.repeat(n) // n characters, n / 4 rough tokens

  test('your text is yours, Claude\'s text and thinking are Claude\'s', () => {
    const w = messageWeights([
      user(text(x(400))),
      assistant({ type: 'thinking', thinking: x(200) }, text(x(200))),
    ])
    expect(w).toEqual({ you: 100, claude: 100, reads: 0, commands: 0, edits: 0, otherTools: 0, auto: 0 })
  })

  describe('tool use', () => {
    const call = (id: string, name: string, input: object): ChatMessage =>
      assistant({ type: 'tool_use', id, name, input })
    const result = (id: string, content: unknown): ChatMessage =>
      user({ type: 'tool_result', tool_use_id: id, content })

    test('a Read call and its result are File reads', () => {
      const w = messageWeights([call('t1', 'Read', { file_path: 'a.ts' }), result('t1', x(800))])
      expect(w.reads).toBeGreaterThan(200)
      expect(w.commands + w.edits + w.otherTools).toBe(0)
    })

    test('Grep and Glob are File reads too', () => {
      const w = messageWeights([call('g', 'Grep', { pattern: 'x' }), call('h', 'Glob', { pattern: '*' })])
      expect(w.reads).toBeGreaterThan(0)
      expect(w.otherTools).toBe(0)
    })

    test('a shell command and its output are Commands', () => {
      const w = messageWeights([call('b', 'Bash', { command: 'npm test' }), result('b', x(400))])
      expect(w.commands).toBeGreaterThan(100)
      expect(w.reads).toBe(0)
    })

    test('a shell command that only reads is File reads', () => {
      const w = messageWeights([call('b', 'Bash', { command: 'cat hooks/config.ts' }), result('b', x(400))])
      expect(w.reads).toBeGreaterThan(100)
      expect(w.commands).toBe(0)
    })

    test('Edit and Write are Edits', () => {
      const w = messageWeights([
        call('e', 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: x(400) }),
        result('e', 'ok'),
        call('w', 'Write', { file_path: 'b.ts', content: x(400) }),
      ])
      expect(w.edits).toBeGreaterThan(200)
      expect(w.reads + w.commands + w.otherTools).toBe(0)
    })

    test('any other tool is Other tools, nested result blocks included', () => {
      const w = messageWeights([
        call('m', 'mcp__browser__get_page_text', {}),
        result('m', [text(x(400)), { type: 'image', source: {} }]),
      ])
      expect(w.otherTools).toBeGreaterThan(100 + IMAGE_TOKENS_ESTIMATE)
    })

    test('a result whose call is out of reach is Other tools', () => {
      const w = messageWeights([result('lost', x(400))])
      expect(w.otherTools).toBe(100)
    })

    test('a result follows its own call, not the one before it', () => {
      const w = messageWeights([
        assistant(
          { type: 'tool_use', id: 'r', name: 'Read', input: {} },
          { type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'npm test' } },
        ),
        user({ type: 'tool_result', tool_use_id: 'c', content: x(4000) }, { type: 'tool_result', tool_use_id: 'r', content: x(40) }),
      ])
      expect(w.commands).toBeGreaterThan(w.reads)
    })
  })

  describe('shell commands that only read', () => {
    const cases: [string, boolean][] = [
      ['cat file.ts', true],
      ['head -n 20 a.txt', true],
      ['grep -n foo src', true],
      ['rg foo', true],
      ['ls -la', true],
      ['sed -n 10,20p a.ts', true],
      ['cd ~/x && cat a.ts', true],
      ['cd C:/repo; grep -rn foo .', true],
      ['FOO=1 cat a', true],
      ['T=~/types.d.ts; grep -n foo $T', true],
      ['M="C:/repo"; F="$M/a.ts"; sed -n 1,9p "$F"', true],
      ['$f = "a.txt"; Get-Content $f', true],
      ['M=~/x; cd "$M" && npm test', false],
      ["cat > notes.md <<'EOF'", false],
      ['cat a.txt >> b.txt', false],
      ['grep foo a.ts >out.txt', false],
      ['grep foo a.ts 2>/dev/null', true],
      ['ls missing 2>&1', true],
      ['Get-Content a.txt 2>$null', true],
      ['Get-Content a.txt', true],
      ['get-content a.txt', true],
      ['sed -i s/a/b/ a.ts', false],
      ['npm test', false],
      ['git push', false],
      ['cd ~/x && npm run build', false],
      ['rm -rf dist', false],
      ['', false],
    ]
    for (const [command, reads] of cases) {
      test(`${JSON.stringify(command)} ${reads ? 'reads' : 'does more than read'}`, () => {
        expect(isShellRead(command)).toBe(reads)
      })
    }

    test('PowerShell reads count as File reads too', () => {
      expect(toolPart('PowerShell', { command: 'Get-Content a.txt' })).toBe('reads')
      expect(toolPart('PowerShell', { command: 'Remove-Item a.txt' })).toBe('commands')
    })
  })

  test('reminders, command echoes and skill text are Auto context', () => {
    const w = messageWeights([
      user(text(`<system-reminder>${x(380)}</system-reminder>`)),
      user(text(`<command-name>/reload-plugins</command-name>${x(100)}`)),
      user(text(`<local-command-stdout>${x(100)}`)),
      user(text(`Base directory for this skill: ${x(100)}`)),
      user(text(`[Image: source: C:\shot.png]`)),
    ])
    expect(w.you).toBe(0)
    expect(w.auto).toBeGreaterThan(0)
  })

  test('a reminder appended to your own text is taken out of it', () => {
    const reminder = `<system-reminder>${x(365)}</system-reminder>` // 17 + 365 + 18 = 400 chars
    const w = messageWeights([user(text(`${x(400)}\n${reminder}`))])
    expect(w.auto).toBe(100)
    expect(w.you).toBe(100.25) // your 400 chars and the newline
  })

  test('images and documents you paste are yours', () => {
    const w = messageWeights([user({ type: 'image', source: {} }, { type: 'document', source: {} })])
    expect(w.you).toBe(2 * IMAGE_TOKENS_ESTIMATE) // sizes unknown: the estimate
  })

  describe('image size', () => {
    // Base64 of a byte array, for building image headers.
    const b64 = (bytes: number[]) => {
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      let out = ''
      for (let i = 0; i < bytes.length; i += 3) {
        const [a, b = 0, c = 0] = [bytes[i]!, bytes[i + 1], bytes[i + 2]]
        const n = (a << 16) | (b << 8) | c
        out += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + A[(n >> 6) & 63]! + A[n & 63]!
      }
      return out
    }
    const u32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]
    const png = (w: number, h: number) =>
      b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(w), ...u32(h), 8, 6, 0, 0, 0])
    const jpeg = (w: number, h: number) =>
      b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0])
    const gif = (w: number, h: number) => b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8, 0, 0])
    const image = (data: string): ChatBlock => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })

    test('reads PNG, JPEG and GIF sizes', () => {
      expect(imageSize(png(703, 42))).toEqual({ width: 703, height: 42 })
      expect(imageSize(jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 })
      expect(imageSize(gif(320, 200))).toEqual({ width: 320, height: 200 })
      expect(imageSize(b64([1, 2, 3, 4, 5, 6]))).toBeUndefined()
    })

    test('a small screenshot costs width × height ÷ 750', () => {
      expect(imageTokens(image(png(703, 42)))).toBe(40) // 703 × 42 ÷ 750 = 39.4
    })

    test('a large one is scaled down first, so it stays near 1,600', () => {
      const tokens = imageTokens(image(png(3840, 2160)))
      expect(tokens).toBeGreaterThan(1400)
      expect(tokens).toBeLessThanOrEqual(1600)
    })

    test('an unreadable one counts as the estimate', () => {
      expect(imageTokens(image('notbase64!'))).toBe(IMAGE_TOKENS_ESTIMATE)
    })
  })

  test('the compaction summary is Claude\'s', () => {
    const w = messageWeights([user(text(`${COMPACTION_SUMMARY_PREFIX} that ran out of context. ${x(400)}`))])
    expect(w.claude).toBeGreaterThan(100)
    expect(w.you + w.auto).toBe(0)
  })

  test('the parts add up to exactly the official total', () => {
    for (const total of [1, 7, 999, 26_843, 150_001]) {
      const weights = { you: 3.3, claude: 7.1, reads: 9.2, commands: 13.9, edits: 2.4, otherTools: 0.6, auto: 1.7 }
      const parts = splitTokens(total, weights)
      expect(Object.values(parts).reduce((n, v) => n + v, 0)).toBe(total)
    }
  })

  test('shares follow the weights', () => {
    const weights = { you: 1, claude: 1, reads: 1, commands: 1, edits: 0, otherTools: 0, auto: 0 }
    expect(splitTokens(1000, weights)).toEqual({ you: 250, claude: 250, reads: 250, commands: 250, edits: 0, otherTools: 0, auto: 0 })
  })

  test('Messages is replaced in place by the parts, in a fixed order', () => {
    const segments = splitMessages(
      [seg('System tools', 6_800), seg('Messages', 10_000), seg('Free space', 100_000, 'free')],
      [
        user(text(x(400))),
        assistant(text(x(400))),
        assistant({ type: 'tool_use', id: 'w', name: 'Write', input: { content: x(400) } }),
        assistant({ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: x(400) } }),
        user(text('<system-reminder>' + x(400) + '</system-reminder>')),
      ],
    )
    expect(segments.map(s => s.name)).toEqual([
      'System tools', 'Your messages', "Claude's replies", 'File reads', 'Edits', 'Auto context', 'Free space',
    ])
    expect(segments.slice(1, 6).reduce((n, s) => n + s.tokens, 0)).toBe(10_000)
  })

  test('nothing to weigh, or no Messages row: the breakdown stays as it is', () => {
    const breakdown = [seg('Messages', 10_000), seg('Free space', 100_000, 'free')]
    expect(splitMessages(breakdown, [])).toEqual(breakdown)
    expect(splitMessages([seg('Free space', 1, 'free')], [user(text('hi'))])).toEqual([seg('Free space', 1, 'free')])
  })

  test('each part has its own colour from config', () => {
    for (const name of Object.values(MESSAGE_PART_NAMES)) {
      expect(colorOf(seg(name, 1))).toBe(CATEGORY_COLORS[name])
    }
  })
})
