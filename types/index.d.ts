export type Limit = { pct: number; resetsAt: string | null }

export type Usage = {
  startedAt: number
  ctxPct: number | null
  ctxTokens: number | null
  ctxWindow: number
  fiveHour: Limit | null
  week: Limit | null
  costUsd: number | null
}

export type Totals = {
  turns: number
  /** Uncached input + cache writes + output, summed over main-loop turns. */
  freshTokens: number
  /** Every input token (uncached, cache read, cache write), summed. */
  inputAll: number
  cacheRead: number
  output: number
}

export type Ident = { model: string; folder: string; branch: string }

export type SlotStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed'

export type Slot = {
  id: string
  type: string
  card: string | null
  title: string
  activity: string
  status: SlotStatus
  startedAt: number
  endedAt: number | null
  tools: number
  tokens: number
  worktree: string | null
  /** Tool-call times (clock ms) over the last minute or two, for the sparkline. */
  calls: number[]
}

export type Board = {
  next: number
  inProgress: number
  blockedByHuman: number
  doneToday: number
  titles: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    'fleet-strip': {
      usage: Usage | null
      totals: Totals
      ident: Ident
      slots: Slot[]
      board: Board | null
      now: number
    }
  }
}
