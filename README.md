# claude-mods

Mods for [Claude Code](https://claude.com/claude-code) by FabianFTR.

## context-bar

A compact band above the prompt showing:

- **Context**: how the context window is used, category by category, with a legend.
- **Session** and **Weekly**: your 5-hour and 7-day usage limits, coloured by where
  your current pace leads (green, yellow, red).

Toggle it with `/context-bar`, or one part with `/context-bar context|session|weekly`.
Details and settings: [plugins/context-bar](plugins/context-bar/README.md).

### Install

In a `claude` terminal session:

```
/plugin install context-bar --marketplace FabianFTR/claude-mods
```

Answer `y` to add the marketplace, then choose the **user** scope. It works in the
terminal and in the Claude desktop app's Code tab from then on.

### Update

```bash
claude plugin update context-bar@faby-mods
```

Then run `/reload-plugins` in any open session.

### Notes

- Session and Weekly need a Pro or Max subscription and appear after the first reply.
- If your Windows display scaling is not 100%, set `DISPLAY_SCALE` in
  `plugins/context-bar/hooks/config.ts` (for example `1.25` for 125%).
