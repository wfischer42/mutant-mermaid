/**
 * Renders every examples/mermaid/*.mmd (or those whose name contains a filter) headlessly with our
 * Mermaid theme, to SVG and PNG under out/mermaid/, in light and dark, and prints any errors.
 * PNGs are screenshots from the same Chromium, since resvg can't draw much of Mermaid's CSS.
 *
 *   pnpm mermaid:snapshots                    all specimens, meadow, light and dark
 *   pnpm mermaid:snapshots gantt pie          only those
 *   pnpm mermaid:snapshots --theme=dusk --dark
 *   pnpm mermaid:snapshots --all-themes       every preset
 *   pnpm mermaid:snapshots --jsdom            without a browser, to name.jsdom.png, drawn by resvg
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeHeadless, rasterizeHeadless, renderMermaidHeadless } from '../src/mermaid/headless.ts'
import { rasterizeJsdom, renderMermaidJsdom } from '../src/mermaid/jsdom.ts'
import { PRESETS, resolveTheme } from '../src/theme/index.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const filters = args.filter((a) => !a.startsWith('--'))
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const themes = args.includes('--all-themes') ? Object.keys(PRESETS) : [option('theme') ?? 'meadow']
const onlyLight = args.includes('--light')
const onlyDark = args.includes('--dark')
const jsdom = args.includes('--jsdom')
const modes = [...(onlyDark ? [] : [false]), ...(onlyLight ? [] : [true])]

const dir = join(root, 'examples', 'mermaid')
const outDir = join(root, 'out', 'mermaid')
mkdirSync(outDir, { recursive: true })

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.mmd'))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))

/** The output path for a specimen: `name[.theme][.dark].png`, meadow being the default. */
function outPath({ file, theme, dark }: { file: string; theme: string; dark: boolean }): string {
  const parts = [
    file.replace(/\.mmd$/, ''),
    theme === 'meadow' ? '' : theme,
    dark ? 'dark' : '',
    jsdom ? 'jsdom' : '',
  ]
  return join(outDir, `${parts.filter(Boolean).join('.')}.png`)
}

async function snapshot({
  file,
  theme,
  dark,
}: {
  file: string
  theme: string
  dark: boolean
}): Promise<boolean> {
  const tokens = resolveTheme({ theme, dark })
  const started = performance.now()
  const source = readFileSync(join(dir, file), 'utf8')
  const result = await (jsdom ? renderMermaidJsdom : renderMermaidHeadless)({ source, tokens })
  const out = outPath({ file, theme, dark })
  const label = `${file}${theme === 'meadow' ? '' : ` [${theme}]`}${dark ? ' (dark)' : ''}`
  if ('error' in result) {
    console.log(`FAIL ${label}\n${result.error}`)
    return false
  }
  writeFileSync(out.replace(/\.png$/, '.svg'), result.svg)
  writeFileSync(out, await (jsdom ? rasterizeJsdom : rasterizeHeadless)({ svg: result.svg }))
  const ms = Math.round(performance.now() - started)
  console.log(`ok   out/mermaid/${out.split('/').pop()}  ${result.width}×${result.height}  ${ms}ms`)
  return true
}

const jobs = themes.flatMap((theme) =>
  modes.flatMap((dark) => files.map((file) => snapshot({ file, theme, dark }))),
)
const results = await Promise.all(jobs)
if (!jsdom) await closeHeadless()
const failed = results.filter((ok) => !ok).length
process.exitCode = failed ? 1 : 0
