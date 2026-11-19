/**
 * Named timing spans for finding where render time goes. Wrap a costly phase in `span()`; it costs
 * one null check unless `profiling()` is collecting, so spans can stay in shipped code. Nested
 * spans count their own time and their children's, so `layout` includes `untangle`.
 */

let totals: Record<string, number> | null = null

/**
 * Runs `fn`, adding its time to `name` when a profile is being collected. A promise counts until
 * it settles.
 */
export function span<T>(name: string, fn: () => T): T {
  if (!totals) return fn()
  const collecting = totals
  const started = performance.now()
  const done = () => {
    collecting[name] = (collecting[name] ?? 0) + performance.now() - started
  }
  let result: T
  try {
    result = fn()
  } catch (error) {
    done()
    throw error
  }
  if (result instanceof Promise) result.finally(done).catch(() => {})
  else done()
  return result
}

/** Runs `fn` and returns its result with the total ms spent in each span it entered. */
export async function profiling<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; totals: Record<string, number> }> {
  const outer = totals
  const own: Record<string, number> = {}
  totals = own
  try {
    return { result: await fn(), totals: own }
  } finally {
    totals = outer
  }
}
