# usage-meter

A [Claude Code](https://claude.com/claude-code) mod that draws a card above the prompt:

- **Context**: tokens used against the window (`484k / 1M (48%)`), a bar split into System, Tools, Files and Messages, the free space, and a tick where auto-compaction runs.
- **Current session** and **Weekly limits**: usage against the time elapsed in the 5-hour and 7-day windows, with the time left until each resets. The bright part of a bar is usage, the dim part is what was allowed so far and not used, and the tick marks how much of the window's time has passed. A bar turns red at 90% or more.
- **Cache**: how warm the prompt cache is, the share of the last prompt it served, and the minutes left.

It keeps three columns down to 80 terminal columns and stacks them below that. It draws on the terminal and the desktop app, and yields to a survey.

## Install

In a terminal session:

```
/plugin install usage-meter --marketplace wirawansanusi/claude-mods-usage-meter
```

Answer `y` to add the marketplace, then pick a scope (user, to have it in every session). Keep the prompt-cache lifetime at `1h` or pick `5m`, and save. The card appears right away.

## Options

| Option | Default | |
| --- | --- | --- |
| `cacheTtl` | `1h` | How long the prompt cache keeps a conversation warm after each response: `1h` or `5m`. Change it with `/plugin configure usage-meter@wirawan-mods`. |

## What it costs

Nothing. The mod only reads figures Claude Code already has and draws them. It adds no system-prompt text, tools or messages, and makes no model calls. It asks for the context breakdown in its `summary` mode, which is estimated locally and sends no requests.

## Good to know

- **Rate limits need a subscription.** On an API-key account the two limit columns say "Waiting for a reading".
- **Cache warmth is an estimate.** The API doesn't report it, so it is the time since the last response against the configured lifetime. After a mod reload or a resumed session the column says "Waiting for a reply" until the next response.
- **Categories come from `/context`'s row names**: system prompt, tools, memory files, messages. A row it doesn't know is counted under "Other", so the totals stay right.
- **The split between categories is an estimate.** The `summary` breakdown estimates each category locally, while `/context` counts them with the token-count API, so the two can differ. The total is the last response's own figure, so it matches `/context` after each response.

## Development

```
claude plugin validate .   # manifest, marketplace and hooks module
claude plugin test .       # tests/
tsc -p .                   # type-check, once Claude Code has loaded the mod and laid its types
```

| File | |
| --- | --- |
| `hooks/register.tsx` | The hooks: take the figures at session start, after each turn and after a compaction, and draw the card. |
| `hooks/model.ts` | Turns `$.session.usage()` into the card's one value, and reads the pace and cache from it. |
| `hooks/bars.ts` | The bars, as runs of coloured text. |
| `hooks/card.tsx` | The card itself. |
| `types/index.d.ts` | The contract for the mod's state. |

Run it from a clone with `claude --plugin-dir <folder>`, or add the folder as a marketplace (`claude plugin marketplace add <folder>`) and install it from there.

## License

[MIT](LICENSE)
