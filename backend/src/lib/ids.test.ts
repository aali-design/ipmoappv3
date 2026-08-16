import { describe, expect, it, vi } from 'vitest'
import { nextCounter } from './ids.js'
import type { DbClient } from '../db/pool.js'

interface FakeQueryResult {
  rows: unknown[]
  rowCount: number
}

function fakeDb(updateValue: string | null): DbClient {
  const queries: { sql: string; params: unknown[] }[] = []
  const db = {
    query: vi.fn(async (sql: string, params: unknown[]): Promise<FakeQueryResult> => {
      queries.push({ sql, params })
      if (sql.includes('INSERT INTO counters')) {
        return { rows: [], rowCount: 0 }
      }
      if (sql.includes('UPDATE counters')) {
        return updateValue === null
          ? { rows: [], rowCount: 0 }
          : { rows: [{ value: updateValue }], rowCount: 1 }
      }
      throw new Error(`unexpected query: ${sql}`)
    }),
  }
  return { db, queries } as unknown as DbClient & { db: typeof db; queries: typeof queries }
}

describe('nextCounter (spec §7 — gapless per-school counters)', () => {
  it('mints the next value as a bigint via an atomic UPDATE…RETURNING', async () => {
    const { db } = fakeDb('7')
    const value = await nextCounter(db as unknown as DbClient, 's1', 'receipt')
    expect(value).toBe(7n)
  })

  it('issues the atomic increment, never MAX()+1', async () => {
    const { db, queries } = fakeDb('9')
    await nextCounter(db as unknown as DbClient, 's1', 'receipt')
    const updateSql = queries.find((q) => q.sql.includes('UPDATE counters'))!.sql
    expect(updateSql).toMatch(/UPDATE counters SET value = value \+ 1/)
    expect(updateSql).not.toMatch(/MAX\(/)
  })

  it('seeds the counter row with the provided initial value', async () => {
    const { db, queries } = fakeDb('1')
    await nextCounter(db as unknown as DbClient, 's1', 'receipt', 100n)
    const insert = queries.find((q) => q.sql.includes('INSERT INTO counters'))!
    expect(insert.params).toEqual(['s1', 'receipt', '100'])
  })

  it('throws when the UPDATE returns no row', async () => {
    const { db } = fakeDb(null)
    await expect(nextCounter(db as unknown as DbClient, 's1', 'receipt')).rejects.toThrow('counter not found')
  })
})
