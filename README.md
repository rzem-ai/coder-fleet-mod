# fleet-strip

A Claude Code mod that draws a fixed six-row strip under the prompt box. It never grows or shrinks as events happen, so the prompt doesn't jump around while agents start and finish.

```
ctx  ███░░░░░░░░░░░░░░░░░   17% 174k/1M     5h  ██████░░░░░░   48% ↻ 2h14m     wk  ███░░░░░░░   31%
◆ Opus 5.5 · coder-fleet-mod · ⎇ HEAD   $  3.42 session   18k tok/turn   cache 91%  turn  14   ⏱   47m
⠹ coder     BD-142    band height fixed      Edit src/band.ts                  2m10s  ▂▃▅▆▇▅
⠼ reviewer  BD-139    hook timeout           Bash pnpm test --filter hooks     0m48s  ▁▂▂▃▅▆
· slot 3    idle
fleet 2/3 busy   next 4   in progress 2   blocked by human 1
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install fleet-strip --marketplace rzem-ai/coder-fleet-mod
```

Answer `y` to add the marketplace, then pick a scope (user scope is the first choice).

From a shell:

```
claude plugin install fleet-strip --marketplace rzem-ai/coder-fleet-mod
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `rzem-ai/coder-fleet-mod`, then Add plugin. The strip itself draws in the terminal only.

## What each row shows

1. **Gauges.** Context window fill, the 5-hour and weekly rate-limit windows with their reset times. Bars go yellow then red as they fill.
2. **Session.** Model, folder, git branch, session cost, fresh tokens per turn, cache hit rate, turn count and elapsed time. Past 85% context it swaps cache and turn for a compaction warning.
3. **Agent slots 1 to 3.** One row per subagent: type, board card (from a `Board-Item:` line in its prompt), what it is doing now, how long it has run and a sparkline of its tool calls. Empty slots say `idle`. Finished agents linger for two minutes with a tick or a cross.
4. **Fleet summary.** How many slots are busy, `+n more` when agents outnumber slots, and counts from the coder-fleet board if the repository has one (read straight from `.claude/worktrees/coder-fleet-state/.boards/tasks/`).

At 180 columns or wider the same six rows spread out: longer bars, the weekly reset time, tokens in and out, and per-agent worktree, tool count and tokens.

The strip replaces what a custom status line usually shows (model, folder, branch, context), so you can turn that status line off once this is installed.

## Notes

- Rate-limit bars only fill on a Claude subscription; with an API key they show `—`.
- Colours are Atom One Dark and assume a dark terminal theme.
- The rest of the hint line under the prompt (mode, shortcuts) is left as Claude Code draws it, underneath the strip.

## Develop

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```
