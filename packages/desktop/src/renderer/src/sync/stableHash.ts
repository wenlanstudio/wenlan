// sync-design D1: a block's re-anchoring hash must cover its FULL canonical
// state — type, attributes, text, and render-affecting metadata — not just the
// visible text. Muya produces the same logical state through different paths
// (markdown parse vs. ot-json1 apply), so object key order is normalized before
// hashing or equivalent states would hash differently.

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

// FNV-1a 64-bit. BigInt keeps the birthday-bound collision risk negligible for
// long documents with many structurally similar blocks (a 32-bit hash starts
// colliding around 77k snapshots). charCodeAt splits surrogate pairs into two
// halves, which is fine here: the input is a serialization, not user identity.
const FNV64_OFFSET = 0xcbf29ce484222325n
const FNV64_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn

export function stableHash64(value: unknown): string {
  const source = stableStringify(value)
  let hash = FNV64_OFFSET
  for (let i = 0; i < source.length; i++) {
    hash ^= BigInt(source.charCodeAt(i))
    hash = (hash * FNV64_PRIME) & MASK64
  }
  return hash.toString(16).padStart(16, '0')
}
