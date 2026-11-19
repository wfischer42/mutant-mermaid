#!/usr/bin/env -S npx tsx
/**
 * mutant-mermaid render <file|-> [-o out.svg|out.png|out.html] [--inline] [--theme meadow] [--dark]
 * mutant-mermaid list
 * mutant-mermaid guide [keyword]
 *
 * Errors go to stderr with line numbers, so an agent can fix the source and try again.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  diagramTypes,
  engineToPng,
  formatDiagnostics,
  guide,
  renderAuto,
} from './node.ts'
import { adaptive } from './adaptive.ts'
import { inlineImg } from './inline.ts'
import { parseLook } from './theme/index.ts'

const USAGE = `usage: mutant-mermaid render <file|-> [-o out.svg|out.png|out.html] [--inline]
         [--theme name] [--dark] [--look name] [--scale n]
       mutant-mermaid list
       mutant-mermaid guide [keyword]`

function args() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        theme: { type: 'string', short: 't' },
        dark: { type: 'boolean' },
        look: { type: 'string' },
        scale: { type: 'string' },
        inline: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : e}\n${USAGE}`)
    process.exit(2)
  }
}

const { positionals, values } = args()
const [command, file] = positionals

async function main(): Promise<number> {
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  if (command === 'list') {
    for (const type of diagramTypes())
      console.log(`${type.keywords.join(', ').padEnd(28)} ${type.summary}`)
    return 0
  }
  if (command === 'guide') return printGuide(file)
  if (command !== 'render' || !file) {
    console.error(USAGE)
    return 2
  }
  const source = readFileSync(file === '-' ? 0 : file, 'utf8')
  const look = parseLook(values.look) ?? undefined
  try {
    const options = { theme: values.theme, dark: values.dark, look }
    const rendered = await renderAuto(source, options)
    await write({ rendered, options: { ...options, source } })
    if (rendered.diagnostics.length) console.error(formatDiagnostics(rendered.diagnostics))
    return 0
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 1
  }
}

/** Prints the catalog, or one type's syntax and example. */
function printGuide(keyword: string | undefined): number {
  const text = guide(keyword)
  if (text === null) {
    console.error(`No diagram type called "${keyword}". Run \`mutant-mermaid guide\` for the list.`)
    return 1
  }
  console.log(text)
  return 0
}

/**
 * Writes to stdout, an .svg file, a .png file rasterized by the engine that drew it, or with
 * `--inline` (or to an .html file) an `<img>` tag for a chat's HTML view. Unless `--dark` fixes
 * the scheme, svg and inline output follow the viewer's light or dark setting.
 */
async function write({
  rendered,
  options,
}: {
  rendered: Awaited<ReturnType<typeof renderAuto>>
  options: Parameters<typeof renderAuto>[1] & { source: string }
}): Promise<void> {
  const out = values.out
  if (out?.endsWith('.png'))
    return writeFileSync(out, await engineToPng({ ...rendered, scale: Number(values.scale ?? 2) }))
  const dark = values.dark ? null : await renderAuto(options.source, { ...options, dark: true })
  const drawing = (dark && adaptive({ light: rendered.svg, dark: dark.svg })) || null
  const text =
    values.inline || out?.endsWith('.html')
      ? inlineImg(drawing ?? rendered.svg)
      : (drawing?.svg ?? rendered.svg)
  if (!out) return void process.stdout.write(text)
  writeFileSync(out, text)
}

process.exitCode = await main()
