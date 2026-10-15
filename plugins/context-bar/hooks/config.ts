// Everything about how the context bar looks lives here. Change a value,
// run /reload-plugins, and the bar redraws with it.

// ── Colours ─────────────────────────────────────────────────────────────────
// One colour per /context category, used by both the bar and the legend so
// they always match. Keys are the category names exactly as /context prints
// them. Green, yellow and red are deliberately left unused.
export const CATEGORY_COLORS: Record<string, string> = {
  'Autocompact buffer': '#64748B', // slate: space reserved for compaction
  'Compact buffer': '#64748B', // the same reserve under its other name
  'System prompt': '#E2E8F0', // near-white: the base everything sits on
  'System tools': '#3B82F6', // blue: built-in tools
  'MCP tools': '#06B6D4', // cyan: external tools
  'MCP server instructions': '#0E7490', // deep cyan: same family as MCP tools
  'Custom agents': '#C084FC', // light purple: agents
  'Memory files': '#E879F9', // fuchsia: CLAUDE.md and memory
  Skills: '#F97316', // orange: skills
  Messages: '#7C3AED', // deep violet: the conversation, when not split
  // Messages split by who wrote it (see Messages split below):
  'Your messages': '#A78BFA', // light violet: what you typed and pasted
  "Claude's replies": '#7C3AED', // deep violet: what Claude wrote
  // Tool use: blues like System tools, with reading in parchment so it stands out:
  'File reads': '#D9C49A', // parchment: files read, and what came back
  Commands: '#93C5FD', // light blue: shell commands and their output
  Edits: '#1D4ED8', // deep blue: text written into files
  'Other tools': '#7DD3FC', // sky blue: MCP, browser, web, agents, questions...
  'Auto context': '#94A3B8', // grey-blue: reminders and plugin context added for you
  Other: '#A1A1AA', // neutral grey: what you hid, and everything under 1%
}

// Any category not listed above (a new one in a future version).
export const FALLBACK_COLOR = '#A1A1AA'

// The empty part of the bar, and its legend square.
export const FREE_COLOR = '#3F3F46'

// The fine line framing the whole bar.
export const OUTLINE_COLOR = '#52525B'

// ── Messages split ──────────────────────────────────────────────────────────
// /context counts the whole conversation as one `Messages` row. When on, the
// bar splits it by reading the conversation and weighing each part; the parts
// always add up to the official Messages figure. In bar order:
export const SPLIT_MESSAGES = true
export const MESSAGE_PART_NAMES = {
  you: 'Your messages', // text you typed, images and files you pasted
  claude: "Claude's replies", // Claude's text and thinking, and the compaction summary
  reads: 'File reads', // READ_TOOLS and SHELL_READ_COMMANDS, with what they returned
  commands: 'Commands', // COMMAND_TOOLS, with their output
  edits: 'Edits', // EDIT_TOOLS: the text written
  otherTools: 'Other tools', // every other tool, with its result
  auto: 'Auto context', // reminders, plugin and hook context, command echoes
} as const

// Which tool goes to which part, by name. A tool's result goes with its call.
export const READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']
export const COMMAND_TOOLS = ['Bash', 'PowerShell', 'Monitor', 'BashOutput', 'KillShell']
export const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']

// A shell command whose first program is one of these only reads, so it counts
// as File reads. Leading `cd dir &&` and `VAR=value` are skipped. `sed` counts
// only with -n (sed -i writes).
export const SHELL_READ_COMMANDS = [
  'cat', 'head', 'tail', 'less', 'more', 'sed -n', 'grep', 'egrep', 'rg',
  'ls', 'find', 'tree', 'wc', 'stat', 'file',
  'Get-Content', 'gc', 'Select-String', 'Get-ChildItem', 'gci', 'dir', 'type',
]

// An image counts by its size (width × height ÷ 750, as the API bills it). A
// pasted document, or an image whose size cannot be read, counts as this many
// tokens instead (a typical full screenshot).
export const IMAGE_TOKENS_ESTIMATE = 1500

// Text in your messages that you did not type: blocks starting with any of
// these count as Auto context. <system-reminder> sections inside your own
// text are taken out and counted there too.
export const AUTO_CONTEXT_PREFIXES = [
  '<system-reminder>',
  '<local-command-',
  '<command-name>',
  '<command-message>',
  '[Image: source:',
  'Base directory for this skill',
  'Caveat:',
  '[Usage limit',
  '[Earlier usage-limit',
]

// The summary that replaces the conversation after compaction starts like
// this; it counts as Claude's replies.
export const COMPACTION_SUMMARY_PREFIX = 'This session is being continued from a previous conversation'

// ── Other ───────────────────────────────────────────────────────────────────
// `Other` gathers the categories you hide (click one in the legend, or
// /context-bar hide <name>) and every category below MIN_VISIBLE_SHARE. Click
// Other in the legend to list them; click one there to bring it back.
export const OTHER_NAME = 'Other'

// A category below this share of the window goes into Other. 0.01 = 1%.
export const MIN_VISIBLE_SHARE = 0.01

// Other is drawn at least this wide on the bar, so it shows even when tiny.
// 0.003 = 0.3% of the bar.
export const OTHER_MIN_BAR_SHARE = 0.003

// Categories hidden until you choose otherwise; your choice is then
// remembered across sessions.
export const DEFAULT_HIDDEN: string[] = []

// ── Bar ─────────────────────────────────────────────────────────────────────

// Bar height in the desktop app, in CSS pixels (about one text row).
export const BAR_HEIGHT_PX = 14

// How the compaction reserve is drawn: a stripe this many units wide every
// `HATCH_SPACING` units, over its colour at `HATCH_BASE_OPACITY`.
export const HATCH_STRIPE = 2
export const HATCH_SPACING = 4
export const HATCH_BASE_OPACITY = 0.55

// Characters used in a terminal, where the bar is drawn from text.
export const TERMINAL_GLYPHS = {
  used: '█',
  reserve: '▒',
  free: '░',
  pace: '│',
}

// ── Usage limits ────────────────────────────────────────────────────────────
// The rate-limit windows shown under the context bar, one thin row each, in
// this order.
//   kind       the name the API reports the window under
//   icon       drawn before the label, so the rows tell apart at a glance
//   heightPx   bar height in the desktop app, in screen pixels (see Screen scale)
//   divisions  equal parts the bar is split into (hours, days); 1 for none
//   hours      how long the window lasts, for the pace marker
export const LIMITS = [
  { kind: 'five_hour', key: 'session', label: 'Session', icon: '◷', heightPx: 5, divisions: 5, hours: 5 },
  { kind: 'seven_day', key: 'weekly', label: 'Weekly', icon: '▦', heightPx: 5, divisions: 7, hours: 7 * 24 },
] as const

// A limit bar's colour, by where the current pace leads: the share used,
// divided by the share of the window that has passed, is where you will be
// when it resets (the projection).
export const LIMIT_COLORS = {
  ok: '#22C55E', // green: you will reach the reset comfortably
  warn: '#EAB308', // yellow: you will reach it only just
  danger: '#EF4444', // red: at this pace you run out before the reset
}

// Projection thresholds, in percent of the limit at reset time.
export const PROJECTION_WARN_AT = 85
export const PROJECTION_DANGER_AT = 110

// Red whatever the pace once this much is used, in percent.
export const USED_DANGER_AT = 90

// Early in a window the pace means little (5 minutes in, 3% used projects to
// 180%). Until this share of the window has passed (0.1 = 10%) the colour
// comes from the share used alone, with these thresholds in percent.
export const PROJECTION_MIN_ELAPSED = 0.1
export const EARLY_WARN_AT = 65
export const EARLY_DANGER_AT = 90

// Show the projection in the label (`◷ Session 48% → 240%`) when the bar is red.
export const SHOW_PROJECTION_WHEN_RED = false

// The fine lines between a limit bar's divisions.
export const DIVISION_COLOR = '#18181B'

// The pace marker: a line at how much of the window has passed. A bar that
// reaches past it is being used faster than the window refills.
export const PACE_COLOR = '#F4F4F5'
export const PACE_MARKER = true

// Width of the label in front of a limit bar, in characters, so the bars of
// both rows start at the same place.
export const LIMIT_LABEL_WIDTH = 28

// ── Screen scale ────────────────────────────────────────────────────────────
// The desktop app draws everything at its zoom (Ctrl + / Ctrl -). A bar whose
// height is not a whole number of screen pixels after zoom is rounded up or
// down depending on where it falls, so two equal bars can end up a pixel
// apart. The limit bars are therefore sized in screen pixels: the mod divides
// by the zoom so they always land on whole pixels.
//   APP_ZOOM       'auto' reads it from the app's config; or a number, 1 = 100%
//   DISPLAY_SCALE  Windows display scaling (Settings › Display), 1 = 100%
export const APP_ZOOM: 'auto' | number = 'auto'
export const DISPLAY_SCALE = 1

// ── What is shown ───────────────────────────────────────────────────────────
// The parts shown until you change them with /context-bar or the buttons;
// your choice is then remembered across sessions.
export const DEFAULT_SHOW = { context: true, session: true, weekly: true }

// The small toggle buttons, always in the bottom-right corner. false hides
// them; the /context-bar commands still work.
export const SHOW_TOGGLE_BUTTONS = true

// Columns the buttons take at the right of the last limit row.
export const TOGGLE_COLUMN_WIDTH = 32

// A button shows a dot before its label: filled in its part's colour when
// on, a hollow grey ring with softer text when off. In the desktop app both
// are drawn at the same size, about the height of a lowercase letter. Both
// sizes are in screen pixels (see Screen scale), so every dot comes out the
// same round shape wherever it sits.
export const TOGGLE_DOT_PX = 7
export const TOGGLE_RING_STROKE_PX = 1.25
export const TOGGLE_OFF_DOT_COLOR = '#71717A'
// The same dots in a terminal, where they are characters.
export const TERMINAL_TOGGLE_DOTS = { on: '●', off: '○' }
export const TOGGLE_ON_TEXT_COLOR = '#E4E4E7'
export const TOGGLE_OFF_TEXT_COLOR = '#8B8B94'
// The context button's dot; the limit buttons take their bar's current colour.
export const TOGGLE_CONTEXT_COLOR = CATEGORY_COLORS.Messages!

// ── Details ─────────────────────────────────────────────────────────────────
// Hover a part of a bar to see its name, tokens and share (desktop app only).
// false draws the bars as plain images, without hover.
export const BAR_TOOLTIPS = true

// At the end of the legend: how much the last reply added to the context
// (`+3.2k last reply`).
export const SHOW_GROWTH = true

// The session's cost (`$1.24 session`): 'auto' shows it when there are no
// subscription limits (paying per use), 'always' or 'never' as said.
export const SHOW_COST: 'auto' | 'always' | 'never' = 'auto'

// How often the band redraws on its own, so "resets in" stays current
// between replies, in milliseconds.
export const CLOCK_TICK_MS = 60_000

// ── Alerts ──────────────────────────────────────────────────────────────────
// A short notice above the prompt, once each time a threshold is crossed.
export const ALERTS = true
// When the context window is this full, in percent.
export const CONTEXT_ALERT_AT = 80
// When a usage limit turns red.
export const ALERT_ON_LIMIT_RED = true
// How long a notice stays, in milliseconds.
export const ALERT_TOAST_MS = 8000

// ── Theme ───────────────────────────────────────────────────────────────────
// The colours above suit a dark background. On a light one, these replace
// them. 'auto' follows the system theme (Windows or macOS); set 'dark' or
// 'light' if the Claude app is set differently from your system.
export const THEME: 'auto' | 'dark' | 'light' = 'auto'
export const LIGHT_THEME_COLORS = {
  categories: {
    'System prompt': '#475569', // slate instead of near-white
    'File reads': '#A07D3B', // deeper parchment
    'Auto context': '#64748B',
    Other: '#71717A',
  } as Record<string, string>,
  free: '#E4E4E7',
  outline: '#A1A1AA',
  division: '#FFFFFF',
  pace: '#18181B',
  toggleOnText: '#27272A',
  toggleOffText: '#71717A',
  toggleOffDot: '#A1A1AA',
}

// ── Legend ──────────────────────────────────────────────────────────────────
export const LEGEND_MARKER = '■'
// Columns of space between legend entries.
export const LEGEND_GAP = 2
