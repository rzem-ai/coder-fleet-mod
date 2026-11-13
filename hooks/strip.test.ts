import { expect, test } from 'claude-code/testing'

import type { Slot } from '../types'
import { buildRows, fmtReset, fmtTok, pickSlots, prettyModel } from './register'

const NOW = 1_800_000_000_000

const slot = (id: string, status: Slot['status'], startedAt = NOW - 60_000): Slot => ({
  id,
  type: 'coder-fleet:coder',
  card: 'BD-12',
  title: 'band height fixed',
  activity: 'Edit src/band.ts',
  status,
  startedAt,
  endedAt: status === 'completed' ? NOW - 5_000 : null,
  tools: 4,
  tokens: 12_400,
  worktree: 'feat-band',
  calls: [NOW - 2_000, NOW - 15_000],
})

const base = {
  usage: {
    startedAt: NOW - 47 * 60_000,
    ctxPct: 17,
    ctxTokens: 174_000,
    ctxWindow: 1_000_000,
    fiveHour: { pct: 48, resetsAt: new Date(NOW + 2 * 3_600_000).toISOString() },
    week: { pct: 31, resetsAt: null },
    costUsd: 3.42,
  },
  totals: { turns: 14, freshTokens: 255_000, inputAll: 1_200_000, cacheRead: 1_090_000, output: 84_000 },
  ident: { model: 'claude-opus-5-5', folder: 'coder-fleet-mod', branch: 'HEAD' },
  board: { next: 4, inProgress: 2, blockedByHuman: 1, doneToday: 7, titles: {} },
  now: NOW,
}

const states: Record<string, Slot[]> = {
  fresh: [],
  busy: [slot('a', 'running'), slot('b', 'completed'), slot('c', 'waiting')],
  overflow: ['a', 'b', 'c', 'd', 'e'].map(id => slot(id, 'running')),
}

for (const wide of [false, true]) {
  for (const [name, slots] of Object.entries(states)) {
    test(`six rows, ${wide ? 'wide' : 'narrow'}, ${name}`, () => {
      expect(buildRows({ ...base, slots, wide }).length).toBe(6)
    })
  }
  test(`six rows with no data yet, ${wide ? 'wide' : 'narrow'}`, () => {
    const rows = buildRows({ ...base, usage: null, board: null, slots: [], wide })
    expect(rows.length).toBe(6)
  })
}

test('overflow folds into a count', () => {
  const { shown, busy, overflow } = pickSlots(states.overflow ?? [])
  expect(shown.length).toBe(3)
  expect(busy).toBe(5)
  expect(overflow).toBe(2)
})

test('formatting', () => {
  expect(fmtTok(174_000)).toBe('174k')
  expect(fmtTok(1_000_000)).toBe('1M')
  expect(fmtTok(18_200)).toBe('18k')
  expect(fmtTok(8_100)).toBe('8.1k')
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(fmtReset(new Date(NOW + 3 * 86_400_000 + 6 * 3_600_000).toISOString(), NOW)).toBe('3d 06h')
})
