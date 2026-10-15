# context-bar

A band above the prompt with:

- **Context**: how the context window is used, category by category, with a legend.
  The conversation is split into **Your messages**, **Claude's replies**, what Claude
  did with tools (**File reads**, **Commands**, **Edits**, **Other tools**, each with
  what came back) and **Auto context** (reminders and plugin context added for you).
- **Session** (◷): the 5-hour usage limit, a thin bar split into hours, with the time until it resets.
- **Weekly** (▦): the 7-day usage limit, the same height, split into days.

On each limit bar a light vertical line marks how much of the window has passed.
If the coloured part reaches past it, you are using the limit faster than it refills.

A limit bar's colour says where your current pace leads by the time it resets
(the share used ÷ the share of time passed):

- **green**: you will reach the reset comfortably (under 85% of the limit);
- **yellow**: only just (85–110%);
- **red**: at this pace you run out before the reset, or you have used 90% already.

In the first 10% of a window the pace means little, so the colour comes from the
share used alone (yellow from 65%, red from 90%). The limit bars appear on a
subscription once the first reply has reported them.

## Turning parts on and off

| Command | Does |
| --- | --- |
| `/context-bar` | Hides or shows the whole band |
| `/context-bar context` | Hides or shows the context bar and legend |
| `/context-bar session` | Hides or shows the session limit |
| `/context-bar weekly` | Hides or shows the weekly limit |

The **● Context · ● Session · ● Weekly** buttons in the bottom-right corner do the
same: a filled, coloured dot when a part is on, a hollow grey ring and softer text
when it is off. They stay in that corner whatever you hide. Your choice is
remembered across sessions.

```
[▒▒▒|████|██████████████|                                           ]
 Autocompact buffer · System tools · Messages · ...          Free space
```

- The bar fills from the left: the compaction reserve first, then each category
  in the order `/context` lists them. Free space is what is left on the right.
- A category under 1% of the window shows in the legend only.
- `/context` counts the conversation as one `Messages` row. The bar splits that
  figure by reading the conversation and weighing each part (text by length,
  images by size as the API bills them); the parts always add up to the official
  figure, but the split itself is an estimate. A tool's result goes with its call.
  Shell commands that only read (`cat`, `grep`, `sed -n`, `Get-Content`...) count
  as File reads, unless they write to a file with `>`.
- The bar refreshes after every reply. After compaction it drops back down.

## Customising

All the settings are in [`hooks/config.ts`](hooks/config.ts):

| Setting | What it changes |
| --- | --- |
| `CATEGORY_COLORS` | The colour of each category, in the bar and the legend |
| `FREE_COLOR`, `OUTLINE_COLOR` | The empty track and the line around it |
| `SPLIT_MESSAGES`, `MESSAGE_PART_NAMES` | Whether and how the conversation is split |
| `READ_TOOLS`, `COMMAND_TOOLS`, `EDIT_TOOLS` | Which tool counts as a file read, a command or an edit |
| `SHELL_READ_COMMANDS` | Shell programs that only read, so count as file reads |
| `AUTO_CONTEXT_PREFIXES`, `IMAGE_TOKENS_ESTIMATE` | What counts as auto context; the cost of an image of unknown size |
| `MIN_VISIBLE_SHARE` | The share below which a category is legend-only (`0.01` = 1%) |
| `BAR_HEIGHT_PX` | The bar height in the desktop app |
| `HATCH_*` | The stripes on the compaction reserve |
| `TERMINAL_GLYPHS` | The characters used to draw the bar in a terminal |
| `LEGEND_MARKER`, `LEGEND_GAP` | The legend's square and the space between entries |
| `LIMITS` | Which limits are shown, in what order, and each one's icon, label, bar height and divisions |
| `LIMIT_COLORS` | The green, yellow and red of the limit bars |
| `PROJECTION_*`, `USED_DANGER_AT`, `EARLY_*` | Where the colour changes, by projection and early in a window |
| `SHOW_PROJECTION_WHEN_RED` | Whether a red bar's label shows its projection (`→ 146%`); off |
| `LIMIT_LABEL_WIDTH` | The width of the label in front of a limit bar |
| `PACE_MARKER`, `PACE_COLOR` | The line at how much of the window has passed |
| `DIVISION_COLOR` | The lines between hours (session) or days (weekly) |
| `DEFAULT_SHOW` | Which parts are shown before you choose |
| `SHOW_TOGGLE_BUTTONS` | Whether the toggle buttons are drawn |
| `TOGGLE_*` | The buttons' dots, colours and the width of their column |

After editing, run `/reload-plugins` in Claude Code, then send a message so the
bar redraws.

## Files

| File | Holds |
| --- | --- |
| `hooks/config.ts` | Every setting above |
| `hooks/layout.ts` | Pure helpers: order, sizes, the SVG, the conversation split; no engine calls |
| `hooks/register.tsx` | The hooks: reading usage, the command, drawing |
| `types/index.d.ts` | The shape of the stored values |
| `tests/layout.test.ts` | Tests for the helpers |

## Checking a change

```bash
claude plugin validate .
claude plugin test .
```
