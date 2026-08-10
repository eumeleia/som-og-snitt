// structuredClone is undefined on iOS Safari < 15.4. All call sites in this app
// clone plain JSON-safe data (strings/numbers/arrays/objects), so a JSON round-trip
// is a safe fallback when the native API is missing.
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}
