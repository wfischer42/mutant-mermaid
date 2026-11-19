import { describe, expect, it } from 'vitest'
import { embedFonts, render, renderAuto } from '../src/node.ts'

const source = 'pyramid "x"\n  a\n  b'

describe('embedFonts', () => {
  it('inlines the family an SVG names, and only that one', async () => {
    const { svg } = await render(source, { theme: 'meadow' })
    const embedded = embedFonts(svg)
    expect(embedded).toMatch(
      /<svg\b[^>]*><style>@font-face \{ font-family: 'Nunito'; font-weight: 400;/,
    )
    expect(embedded).toContain('font-weight: 800')
    expect(embedded).not.toContain("font-family: 'Inter';")
  })

  it('follows the theme font', async () => {
    const { svg } = await render(source, { theme: 'ink' })
    expect(embedFonts(svg)).toContain("font-family: 'Inter';")
  })

  it('embeds a heading font named only in the stylesheet', async () => {
    const { svg } = await render(source, { theme: { font: 'inter', headingFont: 'source-sans' } })
    const embedded = embedFonts(svg)
    expect(embedded).toContain("font-family: 'Inter';")
    expect(embedded).toContain("font-family: 'Source Sans 3';")
  })

  it('leaves an SVG that names no bundled font alone', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>'
    expect(embedFonts(svg)).toBe(svg)
  })

  it('is an option on renderAuto', async () => {
    const plain = await renderAuto(source)
    const embedded = await renderAuto(source, { embedFonts: true })
    expect(plain.svg).not.toContain('@font-face')
    expect(embedded.svg).toContain('@font-face')
  })
})
