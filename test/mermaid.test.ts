import { afterAll, describe, expect, it } from 'vitest'
import { closeHeadless, renderMermaidHeadless } from '../src/mermaid/headless.ts'
import { MERMAID_KEYWORDS, mermaidConfig, mermaidKeyword } from '../src/mermaid/index.ts'
import { PRESETS, resolveTheme } from '../src/theme/index.ts'

const HEX = /^#[0-9a-f]{6}$/i
const NOT_COLOR = /font|size|width|opacity|gradient|shadow|darkMode|wrap|tension/i

/** Every color in a config section as [path, value], palettes split into their entries. */
function colors({ section, path }: { section: object; path: string }): [string, string][] {
  const found: [string, string][] = []
  for (const [key, value] of Object.entries(section)) {
    const at = `${path}.${key}`
    if (value && typeof value === 'object') found.push(...colors({ section: value, path: at }))
    else if (key === 'plotColorPalette') {
      for (const entry of String(value).split(',')) found.push([at, entry.trim()])
    } else if (!NOT_COLOR.test(key)) found.push([at, String(value)])
  }
  return found
}

const cases = Object.keys(PRESETS).flatMap((theme) => [
  { theme, dark: false },
  { theme, dark: true },
])

describe('mermaidConfig', () => {
  it.each(cases)('$theme (dark: $dark) uses only valid hex colors', ({ theme, dark }) => {
    const config = mermaidConfig(resolveTheme({ theme, dark }))
    const found = [
      ...colors({ section: config.themeVariables ?? {}, path: 'themeVariables' }),
      ...colors({ section: config.c4 ?? {}, path: 'c4' }),
    ]
    expect(found.length).toBeGreaterThan(100)
    expect(found.filter(([, value]) => !HEX.test(value))).toEqual([])
    expect(config.themeCSS ?? '').not.toMatch(/undefined|NaN|null/)
    expect(config.themeVariables).toMatchObject({ darkMode: dark })
  })

  it('uses the theme font at 14px', () => {
    const tokens = resolveTheme({ theme: 'ink' })
    const config = mermaidConfig(tokens)
    expect(config.themeVariables).toMatchObject({
      fontFamily: tokens.font.family,
      fontSize: '14px',
    })
    expect(config.theme).toBe('base')
  })
})

describe('mermaidKeyword', () => {
  it('reads the type past frontmatter and comments', () => {
    expect(mermaidKeyword('---\ntitle: x\n---\n%% note\nsequenceDiagram\n  A->>B: hi')).toBe(
      'sequenceDiagram',
    )
    expect(mermaidKeyword('graph LR\nA-->B')).toBe('graph')
    expect(mermaidKeyword('nonsense')).toBeNull()
    expect(MERMAID_KEYWORDS).toContain('xychart-beta')
  })
})

describe('renderMermaidHeadless', () => {
  afterAll(() => closeHeadless())

  it('renders a flowchart and explains a broken one', async () => {
    const tokens = resolveTheme({ theme: 'meadow' })
    const ok = await renderMermaidHeadless({
      source: 'flowchart LR\n  A[Start] --> B[End]',
      tokens,
    })
    if ('error' in ok) throw new Error(ok.error)
    expect(ok.svg).toMatch(/^<svg/)
    expect(ok.svg).toContain('Start')
    expect(ok.width).toBeGreaterThan(50)
    expect(ok.height).toBeGreaterThan(20)

    const bad = await renderMermaidHeadless({ source: 'flowchart LR\n  A --> --> B', tokens })
    expect('error' in bad && bad.error).toMatch(/flowchart/)

    const unknown = await renderMermaidHeadless({ source: 'notADiagram\n  x', tokens })
    expect('error' in unknown && unknown.error).toMatch(/isn't a Mermaid diagram type/)
  }, 60_000)
})
