import { describe, expect, it } from 'vitest'
import { canonicalJson, cloneSnapshot, freezeSnapshot, snapshotHash } from './reportCards.js'

describe('report-card snapshot — canonical JSON and hash', () => {
  it('produces identical hashes for key-order differences', () => {
    const a = snapshotHash({ b: 2, a: 1, nested: { z: 1, y: [3, 2, 1] } })
    const b = snapshotHash({ a: 1, nested: { y: [3, 2, 1], z: 1 }, b: 2 })
    expect(a).toBe(b)
  })

  it('produces different hashes for different data', () => {
    expect(snapshotHash({ a: 1, b: 2 })).not.toBe(snapshotHash({ a: 1, b: 3 }))
  })

  it('encodes canonicalJson with sorted keys and no whitespace', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ nested: { b: 1, a: 2 } })).toBe('{"nested":{"a":2,"b":1}}')
  })
})

describe('report-card snapshot — immutability', () => {
  it('a clone is unaffected by later mutation of the source', () => {
    const live = { marks: [{ student_id: 's1', score: 80 }], subjects: ['math'] }
    const snapshot = cloneSnapshot(live)
    const hashBefore = snapshotHash(snapshot)

    // Later edit to the live data (e.g. a teacher changes a mark).
    live.marks[0].score = 95

    expect(snapshotHash(snapshot)).toBe(hashBefore)
  })

  it('freezeSnapshot makes nested objects immutable', () => {
    const snapshot = freezeSnapshot({ marks: [{ score: 80 }] })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen((snapshot as { marks: { score: number }[] }).marks)).toBe(true)
  })
})
