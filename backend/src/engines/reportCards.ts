/**
 * Report-card snapshot helpers (spec §6).
 *
 * A published card stores a frozen snapshot and its hash —
 * `sha256(canonicalJson(snapshot))` where canonicalJson is key-sorted and
 * whitespace-free. Later mark edits never change a published card because the
 * snapshot is a deep copy taken at publish time.
 */

import { createHash } from 'node:crypto'

/** Deterministic, key-sorted, whitespace-free JSON encoding. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

export function snapshotHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/** Deep-freeze a snapshot object so later mutation is impossible. */
export function freezeSnapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    for (const item of value) freezeSnapshot(item)
    return Object.freeze(value) as T
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    freezeSnapshot((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value) as T
}

/** Deep clone (used to snapshot live data at publish time). */
export function cloneSnapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => cloneSnapshot(v)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = cloneSnapshot((value as Record<string, unknown>)[key])
  }
  return out as T
}
