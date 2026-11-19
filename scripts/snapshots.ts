/**
 * Renders every example (or those whose path contains a filter) to PNG under out/, in light and
 * dark, and prints any errors. Use it to look at what a change did:
 *
 *   pnpm snapshots            all examples
 *   pnpm snapshots mindmap    only examples/mindmap/…
 *   pnpm snapshots cld --light
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detect, render, svgToPng } from '../src/node.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const filters = args.filter((a) => !a.startsWith('--'))
const modes = args.includes('--light') ? [false] : [false, true]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return path.endsWith('.mmd') ? [path] : []
  })
}

let failed = 0
for (const file of walk(join(root, 'examples'))) {
  const rel = relative(join(root, 'examples'), file)
  if (filters.length && !filters.some((f) => rel.includes(f))) continue
  const source = readFileSync(file, 'utf8')
  if (!detect(source)) continue
  for (const dark of modes) {
    const out = join(root, 'out', rel.replace(/\.mmd$/, dark ? '.dark.png' : '.png'))
    mkdirSync(dirname(out), { recursive: true })
    try {
      const started = performance.now()
      const { svg, width, height } = await render(source, { dark })
      writeFileSync(out.replace(/\.png$/, '.svg'), svg)
      writeFileSync(out, svgToPng(svg))
      console.log(
        `ok   ${relative(root, out)}  ${width}×${height}  ${Math.round(performance.now() - started)}ms`,
      )
    } catch (e) {
      failed++
      console.log(
        `FAIL ${rel}${dark ? ' (dark)' : ''}\n${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
}
process.exitCode = failed ? 1 : 0
