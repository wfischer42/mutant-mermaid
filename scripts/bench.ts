/**
 * Times render() on every example (or those whose path contains a filter), in-process, so the
 * numbers are layout and drawing alone, without CLI startup or PNG rasterizing. Each example
 * renders once to warm up, then `--runs` more times (default 5); the table shows the median and
 * the slowest run, slowest examples first, with any spans the code marked (see core/profile.ts).
 *
 *   pnpm bench                  all examples
 *   pnpm bench cld --runs 20    only examples whose path contains "cld"
 *   pnpm bench --json           machine-readable, for comparing two runs
 *   pnpm bench --budget 250     exit 1 when any example's median passes 250 ms
 *
 * For a CPU profile to open in Chrome DevTools or speedscope: `pnpm bench:profile cld-city`, which
 * writes profiles/*.cpuprofile.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { profiling } from '../src/core/profile.ts'
const importing = performance.now()
const { detect, render } = await import('../src/node.ts')
const imported = performance.now() - importing

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i < 0 ? undefined : args[i + 1]
}
const valued = new Set(['--runs', '--budget'].flatMap((name) => [name, flag(name)]))
const filters = args.filter((a) => !a.startsWith('--') && !valued.has(a))
const runs = Number(flag('--runs') ?? 5)
const budget = flag('--budget') ? Number(flag('--budget')) : undefined
const json = args.includes('--json')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return path.endsWith('.mmd') ? [path] : []
  })
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

interface Row {
  example: string
  /** The first, cold render: what a host that renders once pays. */
  first: number
  median: number
  max: number
  spans: Record<string, number>
}

const rows: Row[] = []
for (const file of walk(join(root, 'examples'))) {
  const example = relative(join(root, 'examples'), file).replace(/\.mmd$/, '')
  if (filters.length && !filters.some((f) => example.includes(f))) continue
  const source = readFileSync(file, 'utf8')
  if (!detect(source)) continue
  try {
    const cold = performance.now()
    await render(source)
    const first = performance.now() - cold
    const times: number[] = []
    const spans: Record<string, number[]> = {}
    for (let i = 0; i < runs; i++) {
      const started = performance.now()
      const { totals } = await profiling(() => render(source))
      times.push(performance.now() - started)
      for (const [name, ms] of Object.entries(totals)) (spans[name] ??= []).push(ms)
    }
    rows.push({
      example,
      first,
      median: median(times),
      max: Math.max(...times),
      spans: Object.fromEntries(Object.entries(spans).map(([name, ms]) => [name, median(ms)])),
    })
  } catch (error) {
    console.error(`${example}: ${error instanceof Error ? error.message : error}`)
  }
}

rows.sort((a, b) => b.median - a.median)
if (json) console.log(JSON.stringify(rows, null, 2))
else {
  const width = Math.max(...rows.map((r) => r.example.length), 7)
  console.log(`${'example'.padEnd(width)}   first  median     max  spans`)
  for (const r of rows) {
    const spans = Object.entries(r.spans)
      .sort((a, b) => b[1] - a[1])
      .map(([name, ms]) => `${name} ${ms.toFixed(1)}`)
      .join(', ')
    console.log(
      `${r.example.padEnd(width)}  ${r.first.toFixed(1).padStart(6)}  ${r.median.toFixed(1).padStart(6)}  ${r.max.toFixed(1).padStart(6)}  ${spans}`,
    )
  }
  const total = rows.reduce((sum, r) => sum + r.median, 0)
  console.log(`\n${rows.length} examples, ${total.toFixed(0)} ms total (medians of ${runs} runs)`)
  console.log(`Importing took ${imported.toFixed(0)} ms (from source, through tsx)`)
}

const over = budget === undefined ? [] : rows.filter((r) => r.median > budget)
if (over.length) {
  console.error(`\nOver the ${budget} ms budget: ${over.map((r) => r.example).join(', ')}`)
  process.exit(1)
}
