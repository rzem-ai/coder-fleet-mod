import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Ident, Limit, Slot, SlotStatus, Totals, Usage } from '../types'

// ---------------------------------------------------------------------------
// State. Everything the strip draws lives in $.state so a hot reload keeps it.
// ---------------------------------------------------------------------------

const EMPTY_TOTALS: Totals = { turns: 0, freshTokens: 0, inputAll: 0, cacheRead: 0, output: 0 }

const usageA = atom({ plugin: 'fleet-strip', key: 'usage' } as const, null as Usage | null)
const totalsA = atom({ plugin: 'fleet-strip', key: 'totals' } as const, EMPTY_TOTALS)
const identA = atom({ plugin: 'fleet-strip', key: 'ident' } as const, { model: '', folder: '', branch: '' } as Ident)
const slotsA = atom({ plugin: 'fleet-strip', key: 'slots' } as const, [] as Slot[])
const boardA = atom({ plugin: 'fleet-strip', key: 'board' } as const, null as Board | null)
const nowA = atom({ plugin: 'fleet-strip', key: 'now' } as const, 0)

type $T = EngineInterface

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** One Dark. */
const C = {
  fg0: '#dcdfe4',
  fg1: '#abb2bf',
  fg2: '#7f848e',
  fg3: '#5c6370',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  purple: '#c678dd',
  cyan: '#56b6c2',
} as const

const SLOT_COUNT = 3
const WIDE_AT = 180
const FINISHED_LINGER_MS = 120_000
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPARK = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇']
const SPARK_BUCKET_MS = 10_000
const ACTIVE: readonly SlotStatus[] = ['pending', 'running', 'waiting']
const FINISHED: readonly SlotStatus[] = ['completed', 'failed', 'killed']

// ---------------------------------------------------------------------------
// Formatting helpers (pure)
// ---------------------------------------------------------------------------

const padR = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length))
const padL = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(w - s.length) + s)
const trunc = (s: string, w: number) => (s.length > w ? s.slice(0, Math.max(0, w - 1)) + '…' : s)
const fit = (s: string, w: number) => padR(trunc(s, w), w)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

export function fmtTok(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) {
    const k = n / 1000
    return (k < 10 ? k.toFixed(1) : String(Math.round(k))).replace(/\.0$/, '') + 'k'
  }
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
}

export function fmtDur(ms: number, withSeconds = false): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (withSeconds && h === 0) return `${m}m${String(s % 60).padStart(2, '0')}s`
  if (h === 0) return `${m}m`
  return `${h}h${String(m).padStart(2, '0')}m`
}

export function fmtReset(iso: string | null, now: number): string {
  if (!iso) return '—'
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const h = Math.floor(ms / 3_600_000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${String(h % 24).padStart(2, '0')}h`
  return `${h}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}m`
}

export function prettyModel(id: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id)
  const name = m?.[1]
  if (!m || !name) return id || '—'
  const family = name.charAt(0).toUpperCase() + name.slice(1)
  return m[3] ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`
}

export function bar(pct: number | null, width: number): [string, string] {
  if (pct === null) return ['', '░'.repeat(width)]
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return ['█'.repeat(filled), '░'.repeat(width - filled)]
}

const pct4 = (p: number | null) => (p === null ? '  —' : padL(String(Math.round(p)), 3) + '%')
const ctxColor = (p: number | null) => (p === null ? C.fg2 : p >= 85 ? C.red : p >= 70 ? C.yellow : C.green)
const limitColor = (p: number | null) => (p === null ? C.fg2 : p >= 90 ? C.red : p >= 75 ? C.yellow : C.cyan)

export function spark(calls: readonly number[], now: number, width: number): string {
  const buckets = new Array<number>(width).fill(0)
  for (const t of calls) {
    const i = width - 1 - Math.floor((now - t) / SPARK_BUCKET_MS)
    if (i >= 0 && i < width) buckets[i] = (buckets[i] ?? 0) + 1
  }
  const max = Math.max(...buckets)
  if (max === 0) return ' '.repeat(width)
  return buckets.map(n => (n === 0 ? ' ' : (SPARK[Math.max(1, Math.round((n / max) * 7))] ?? '▇'))).join('')
}

const shortType = (t: string) => (t.includes(':') ? t.slice(t.lastIndexOf(':') + 1) : t)

// ---------------------------------------------------------------------------
// Rows. A row is a list of [text, colour] segments; the strip is always six.
// ---------------------------------------------------------------------------

type Seg = readonly [string, string]
type Row = Seg[]

export type View = {
  usage: Usage | null
  totals: Totals
  ident: Ident
  slots: readonly Slot[]
  board: Board | null
  now: number
  wide: boolean
}

function gaugeRow(v: View): Row {
  const w = v.wide ? { ctx: 40, five: 24, week: 24, gap: ' '.repeat(10) } : { ctx: 20, five: 12, week: 10, gap: '   ' }
  const u = v.usage
  const ctx = u?.ctxPct ?? null
  const [cf, ct] = bar(ctx, w.ctx)
  const ctxTok = u && u.ctxTokens !== null ? `${fmtTok(u.ctxTokens)}/${fmtTok(u.ctxWindow)}` : '—'
  const limit = (label: string, l: Limit | null, width: number, showReset: boolean): Row => {
    const p = l?.pct ?? null
    const [f, t] = bar(p, width)
    const row: Row = [[`${label}  `, C.fg1], [f, limitColor(p)], [t, C.fg3], [`  ${pct4(p)}`, p !== null && p >= 75 ? limitColor(p) : C.fg0]]
    if (showReset) row.push([` ↻ ${padR(fmtReset(l?.resetsAt ?? null, v.now), 7)}`, C.fg1])
    return row
  }
  return [
    ['ctx  ', C.fg1],
    [cf, ctxColor(ctx)],
    [ct, C.fg3],
    [`  ${pct4(ctx)}`, ctx !== null && ctx >= 85 ? C.red : C.fg0],
    [` ${padR(ctxTok, 9)}`, C.fg1],
    [w.gap, C.fg1],
    ...limit('5h', u?.fiveHour ?? null, w.five, true),
    [w.gap, C.fg1],
    ...limit('wk', u?.week ?? null, w.week, v.wide),
  ]
}

function identRow(v: View): Row {
  const gap = v.wide ? ' '.repeat(10) : '   '
  const t = v.totals
  const u = v.usage
  const perTurn = t.turns > 0 ? fmtTok(t.freshTokens / t.turns) : '—'
  const cache = t.inputAll > 0 ? `${Math.round((t.cacheRead / t.inputAll) * 100)}%` : '—'
  const cost = u?.costUsd ?? null
  const elapsed = u ? fmtDur(v.now - u.startedAt) : '—'
  const row: Row = [
    [`◆ ${prettyModel(v.ident.model)}`, C.blue],
    [' · ', C.fg2],
    [v.ident.folder || '—', C.fg0],
    [' · ', C.fg2],
    [`⎇ ${v.ident.branch || '—'}`, C.green],
    [gap, C.fg1],
    [`$${padL(cost === null ? '—' : cost.toFixed(2), 6)}`, C.fg0],
    [' session', C.fg1],
    [gap, C.fg1],
    [padL(perTurn, 5), C.fg0],
    [' tok/turn', C.fg1],
  ]
  if (v.wide) {
    row.push([gap, C.fg1], ['in ', C.fg1], [padL(fmtTok(t.inputAll), 4), C.fg0], ['  out ', C.fg1], [padL(fmtTok(t.output), 4), C.fg0])
  }
  row.push([gap, C.fg1])
  if ((u?.ctxPct ?? 0) >= 85) {
    row.push(['! compact soon', C.yellow])
  } else {
    row.push(['cache ', C.fg1], [padR(cache, 4), t.inputAll > 0 ? C.green : C.fg1], [gap.slice(1), C.fg1], ['turn ', C.fg1], [padL(String(t.turns), 3), C.fg0])
  }
  row.push([gap, C.fg1], ['⏱ ', C.fg1], [padL(elapsed, 5), C.fg0])
  return row
}

function slotGlyph(s: Slot, now: number): Seg {
  switch (s.status) {
    case 'pending':
    case 'running':
      return [SPIN[Math.floor(now / 1000) % SPIN.length] ?? '⠋', C.cyan]
    case 'waiting':
      return ['!', C.yellow]
    case 'completed':
      return ['✓', C.green]
    case 'failed':
    case 'killed':
      return ['✗', C.red]
    default:
      return ['·', C.fg2]
  }
}

function slotRow(s: Slot | undefined, index: number, v: View): Row {
  if (!s) return [['·', C.fg2], [` slot ${index + 1}${v.wide ? '     ' : '    '}idle`, C.fg1]]
  const w = v.wide
    ? { type: 10, card: 10, title: 34, act: 40, spark: 8 }
    : { type: 9, card: 9, title: 21, act: 31, spark: 6 }
  const title = (s.card && v.board?.titles[s.card]) || s.title
  const end = s.endedAt ?? v.now
  const activity =
    s.status === 'completed' ? 'done'
    : s.status === 'failed' ? 'failed'
    : s.status === 'killed' ? 'stopped'
    : s.status === 'waiting' ? `waiting · ${s.activity}`
    : s.status === 'idle' ? 'idle'
    : s.activity || 'starting'
  const actColor =
    s.status === 'completed' ? C.green
    : s.status === 'failed' || s.status === 'killed' ? C.red
    : s.status === 'waiting' ? C.yellow
    : C.fg0
  const isLive = ACTIVE.includes(s.status)
  const row: Row = [
    slotGlyph(s, v.now),
    [` ${fit(shortType(s.type), w.type)}`, C.fg0],
    [` ${fit(s.card ?? '', w.card)}`, C.purple],
    [` ${fit(oneLine(title), w.title)}`, C.fg1],
    [`  ${fit(oneLine(activity), w.act)}`, actColor],
  ]
  if (v.wide) {
    row.push([` ${fit(s.worktree ? `wt ${s.worktree}` : '', 22)}`, C.fg1])
    row.push([` ${padL(String(s.tools), 2)} tools`, C.fg1])
    row.push([`   ${padL(fmtTok(s.tokens), 5)} tok`, C.fg0])
  }
  row.push([`  ${padL(fmtDur(end - s.startedAt, true), 5)}`, C.fg1])
  row.push([`  ${isLive ? spark(s.calls, v.now, w.spark) : padR('', w.spark)}`, C.cyan])
  return row
}

export function pickSlots(slots: readonly Slot[]): { shown: Slot[]; busy: number; overflow: number } {
  const active = slots.filter(s => ACTIVE.includes(s.status)).sort((a, b) => a.startedAt - b.startedAt)
  const idle = slots.filter(s => s.status === 'idle')
  const done = slots.filter(s => FINISHED.includes(s.status)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  const shown = [...active, ...idle, ...done].slice(0, SLOT_COUNT)
  return { shown, busy: active.length, overflow: Math.max(0, active.length - SLOT_COUNT) }
}

function summaryRow(v: View, busy: number, overflow: number): Row {
  const row: Row = [
    ['fleet ', C.fg1],
    [busy > 0 ? `${Math.min(busy, SLOT_COUNT)}/${SLOT_COUNT} busy` : 'idle    ', C.fg0],
  ]
  if (overflow > 0) row.push([`   +${overflow} more`, C.cyan])
  const b = v.board
  if (!b) {
    row.push(['   no coder-fleet board in this repo', C.fg2])
    return row
  }
  row.push(
    ['   next ', C.fg1], [String(b.next), C.fg0],
    ['   in progress ', C.fg1], [String(b.inProgress), C.fg0],
    [`   blocked by human ${b.blockedByHuman}`, b.blockedByHuman > 0 ? C.yellow : C.fg1],
  )
  if (v.wide) row.push(['   done today ', C.fg1], [String(b.doneToday), C.fg0])
  return row
}

export function buildRows(v: View): Row[] {
  const { shown, busy, overflow } = pickSlots(v.slots)
  return [
    gaugeRow(v),
    identRow(v),
    ...[0, 1, 2].map(i => slotRow(shown[i], i, v)),
    summaryRow(v, busy, overflow),
  ]
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

const quiet = (p: Promise<unknown>) => void p.catch(() => undefined)

async function refreshUsage($: $T) {
  const u = await $.session.usage()
  const limit = (kind: string): Limit | null => {
    const l = u.rateLimits.find(r => r.kind === kind)
    return l ? { pct: l.percentUsed, resetsAt: l.resetsAt ?? null } : null
  }
  const next: Usage = {
    startedAt: u.startedAt,
    ctxPct: u.context.percent ?? null,
    ctxTokens: u.context.tokens ?? null,
    ctxWindow: u.context.window,
    fiveHour: limit('five_hour'),
    week: limit('seven_day'),
    costUsd: u.cost?.usd ?? null,
  }
  await update($, usageA, () => next)
}

async function refreshIdent($: $T) {
  const [model, cwd] = await Promise.all([$.session.model(), $.session.cwd()])
  let branch = ''
  try {
    const r = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 3000 })
    if (r.exitCode === 0) branch = r.stdout.trim()
  } catch {
    branch = ''
  }
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
  await update($, identA, () => ({ model, folder, branch }))
}

function parseCard(text: string): { id: string; title: string; status: string; updated: string } | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)
  if (!fm) return null
  const lines = (fm[1] ?? '').split('\n')
  const field = (name: string) => {
    const i = lines.findIndex(l => l.startsWith(`${name}:`))
    if (i < 0) return ''
    const rest = (lines[i] ?? '').slice(name.length + 1).trim()
    if (rest === '>-' || rest === '>' || rest === '|' || rest === '|-') {
      const out: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j] ?? ''
        if (!/^\s+/.test(line)) break
        out.push(line.trim())
      }
      return out.join(' ')
    }
    return rest.replace(/^['"]|['"]$/g, '')
  }
  const id = field('id')
  return id ? { id, title: field('title'), status: field('status').toLowerCase(), updated: field('updated_date') } : null
}

function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function refreshBoard($: $T) {
  const repo = await $.session.repo()
  const root = repo?.root ?? (await $.session.cwd())
  const candidates = [`${root}/.claude/worktrees/coder-fleet-state/.boards/tasks`, `${root}/.boards/tasks`]
  let dir: string | null = null
  for (const c of candidates) {
    if (await $.fs.exists(c)) {
      dir = c
      break
    }
  }
  if (!dir) {
    await update($, boardA, () => null)
    return
  }
  const entries = await $.fs.list(dir)
  const today = localDay(await $.clock.now())
  const board: Board = { next: 0, inProgress: 0, blockedByHuman: 0, doneToday: 0, titles: {} }
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
    let text: string
    try {
      text = (await $.fs.read(`${dir}/${entry.name}`)) as string
    } catch {
      continue
    }
    const card = parseCard(text)
    if (!card) continue
    board.titles[card.id] = card.title
    if (card.status === 'next') board.next += 1
    else if (card.status === 'in progress') board.inProgress += 1
    else if (card.status === 'blocked by human') board.blockedByHuman += 1
    else if (card.status === 'done' && card.updated.startsWith(today)) board.doneToday += 1
  }
  await update($, boardA, () => board)
}

async function reconcileAgents($: $T) {
  const [list, now] = await Promise.all([$.agent.list(), $.clock.now()])
  const byId = new Map(list.map(a => [a.id, a]))
  await update($, slotsA, slots => {
    const known = new Set(slots.map(s => s.id))
    const next = slots.map(s => {
      const info = byId.get(s.id)
      if (!info) return s
      const status = info.status as SlotStatus
      const endedAt = FINISHED.includes(status) ? (s.endedAt ?? now) : null
      return { ...s, status, endedAt }
    })
    for (const a of list) {
      if (known.has(a.id) || FINISHED.includes(a.status as SlotStatus)) continue
      next.push(newSlot(a.id, a.type, a.description, '', now, a.status as SlotStatus))
    }
    return next
      .filter(s => s.endedAt === null || now - s.endedAt < FINISHED_LINGER_MS)
      .map(s => ({ ...s, calls: s.calls.filter(t => now - t < 120_000) }))
      .slice(-24)
  })
}

function newSlot(id: string, type: string, description: string, prompt: string, now: number, status: SlotStatus = 'running'): Slot {
  const card = /Board-Item:\s*([A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*)/.exec(prompt)?.[1] ?? null
  return {
    id, type, card, title: description, activity: '', status,
    startedAt: now, endedAt: null, tools: 0, tokens: 0, worktree: null, calls: [],
  }
}

function describeCall(e: Record<string, unknown>, cwd: string): { text: string; worktree: string | null } {
  const tool = String(e.tool)
  const str = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const raw =
    str('command') || str('file_path') || str('notebook_path') || str('pattern') ||
    str('url') || str('query') || str('description') || str('path')
  const wt = /\.claude\/worktrees\/([^/\s]+)/.exec(raw)?.[1] ?? null
  let arg = raw.startsWith(cwd + '/') ? raw.slice(cwd.length + 1) : raw
  arg = arg.replace(/^.*?\.claude\/worktrees\/[^/\s]+\//, '')
  return { text: oneLine(`${tool.replace(/^mcp__[^_]+__/, '')} ${arg}`), worktree: wt }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    quiet(refreshUsage($))
    quiet(refreshIdent($))
    quiet(refreshBoard($))
    quiet(reconcileAgents($))

    let ticks = 0
    $.clock.every(1000, () => {
      ticks += 1
      quiet(
        (async () => {
          const slots = await read($, slotsA)
          const live = slots.some(s => ACTIVE.includes(s.status))
          // Redraw every second while an agent runs (spinner, timers, sparkline);
          // otherwise every 15s keeps the session clock and reset timers honest.
          if (live || ticks % 15 === 0) {
            const now = await $.clock.now()
            await update($, nowA, () => now)
          }
          if (ticks % 5 === 0) await reconcileAgents($)
          if (ticks % 60 === 0) {
            await refreshIdent($)
            await refreshBoard($)
          }
        })(),
      )
    })
    return started
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    quiet(refreshUsage($))
    return r
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const now = await $.clock.now()
      const slot = newSlot(r.agentId, e.subagentType || 'agent', e.description, e.prompt, now)
      await update($, slotsA, slots => [...slots.filter(s => s.id !== slot.id), slot])
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      const [now, cwd] = await Promise.all([$.clock.now(), $.session.cwd()])
      const call = describeCall(e as unknown as Record<string, unknown>, cwd)
      await update($, slotsA, slots =>
        slots.map(s =>
          s.id !== agentId
            ? s
            : {
                ...s,
                status: s.status === 'pending' || s.status === 'idle' ? 'running' : s.status,
                activity: call.text,
                worktree: call.worktree ?? s.worktree,
                tools: s.tools + 1,
                calls: [...s.calls, now].slice(-200),
              },
        ),
      )
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = e.usage
    if (e.agentId !== undefined) {
      const agentId = e.agentId
      const now = await $.clock.now()
      const spent = u ? u.input_tokens + u.cache_creation_input_tokens + u.output_tokens : 0
      await update($, slotsA, slots =>
        slots.map(s =>
          s.id !== agentId
            ? s
            : {
                ...s,
                tokens: s.tokens + spent,
                status: s.type === 'teammate' ? 'idle' : e.isAborted ? 'killed' : 'completed',
                endedAt: s.type === 'teammate' ? null : now,
              },
        ),
      )
      return r
    }
    if (u) {
      await update($, totalsA, t => ({
        turns: t.turns + 1,
        freshTokens: t.freshTokens + u.input_tokens + u.cache_creation_input_tokens + u.output_tokens,
        inputAll: t.inputAll + u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        output: t.output + u.output_tokens,
      }))
    } else {
      await update($, totalsA, t => ({ ...t, turns: t.turns + 1 }))
    }
    quiet(refreshUsage($))
    quiet(refreshIdent($))
    quiet(refreshBoard($))
    return r
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)

    const [usage, totals, ident, slots, board, tickNow] = await Promise.all([
      read($, usageA),
      read($, totalsA),
      read($, identA),
      read($, slotsA),
      read($, boardA),
      read($, nowA),
    ])
    const now = tickNow || (await $.clock.now())
    const wide = (e.viewport?.columns ?? 0) >= WIDE_AT
    const rows = buildRows({ usage, totals, ident, slots, board, now, wide })
    const hint = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Text wrap="truncate">
            {row.map(([text, color]) => (
              <Text color={color}>{text}</Text>
            ))}
          </Text>
        ))}
        {hint}
      </Box>
    )
  })
}
