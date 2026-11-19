import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { textKit } from '../src/core/text.ts'
import { bboxOf, pathPoints, transformOf } from '../src/mermaid/bbox.ts'
import { inlineStyles, specificity } from '../src/mermaid/inline.ts'
import { renderMermaidJsdom } from '../src/mermaid/jsdom.ts'

const kit = textKit({ font: 'nunito', family: 'Nunito' })

function svg(markup: string): Element {
  const { window } = new JSDOM('')
  const doc = new window.DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    'image/svg+xml',
  )
  return doc.documentElement
}

describe('bbox', () => {
  it('bounds an ellipse arc by its own radii', () => {
    const points = pathPoints('M0,10 a40,10 0 0,0 80,0')
    const ys = points.map((p) => p[1])
    expect(Math.min(...ys)).toBe(0)
    expect(Math.max(...ys)).toBe(20)
  })

  it('composes transforms left to right', () => {
    const m = transformOf(svg('<g transform="translate(10 5) scale(2)"/>').children[0])
    expect(m).toEqual([2, 0, 0, 2, 10, 5])
  })

  it('puts a centered tspan line at its em baseline', () => {
    const root = svg(
      '<text y="-10" text-anchor="middle"><tspan x="0" y="-0.1em" dy="1.1em">Hello</tspan></text>',
    )
    const box = bboxOf({ el: root.children[0], kit, fallback: 14 })
    const width = kit.width('Hello', { size: 14 })
    expect(box.x).toBeCloseTo(-width / 2)
    expect(box.y).toBeCloseTo(14 - 14 * kit.metrics.ascent)
  })

  it('unions children through their transforms', () => {
    const root = svg('<g><rect width="10" height="10"/><rect transform="translate(20 0)" width="10" height="5"/></g>')
    expect(bboxOf({ el: root.children[0], kit, fallback: 14 })).toMatchObject({ x: 0, width: 30, height: 10 })
  })
})

describe('inlineStyles', () => {
  it('ranks ids over classes over types', () => {
    expect(specificity('#a .b rect')).toBeGreaterThan(specificity('.b rect'))
    expect(specificity('.b rect')).toBeGreaterThan(specificity('g rect'))
  })

  it('lets !important beat inline style, and inline beat the sheet', async () => {
    await renderMermaidJsdom({ source: 'pie\n  "a": 1' })
    const out = inlineStyles(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red!important;stroke:blue}</style><rect class="a" style="fill:green;stroke:black"/></svg>',
    )
    expect(out).toContain('fill:red')
    expect(out).toContain('stroke:black')
    expect(out).not.toContain('<style')
  })
})

describe('renderMermaidJsdom', () => {
  it.each([
    ['sequenceDiagram\n  Alice->>Bob: Hello'],
    ['classDiagram\n  Animal <|-- Duck'],
    ['erDiagram\n  CUSTOMER ||--o{ ORDER : places'],
    ['gantt\n  dateFormat YYYY-MM-DD\n  section A\n  Task :a1, 2026-01-01, 10d'],
    ['C4Context\n  Person(a, "Reader")\n  System(b, "Shop")\n  Rel(a, b, "Uses")'],
  ])('draws %s at a sensible size', async (source) => {
    const result = await renderMermaidJsdom({ source })
    if ('error' in result) throw new Error(result.error)
    expect(result.width).toBeGreaterThan(100)
    expect(result.width).toBeLessThan(2000)
    expect(result.height).toBeGreaterThan(50)
  })

  it('ends sequence lifelines inside the drawing, above its bottom padding', async () => {
    const result = await renderMermaidJsdom({ source: 'sequenceDiagram\n  Alice->>Bob: Hello' })
    if ('error' in result) throw new Error(result.error)
    const [, y, , h] = (/viewBox="([^"]+)"/.exec(result.svg)?.[1] ?? '').split(' ').map(Number)
    const ends = [...result.svg.matchAll(/<line[^>]*actor-line[^>]*>/g)].map((m) =>
      Number(/y2="([^"]+)"/.exec(m[0])?.[1]),
    )
    expect(ends.length).toBe(2)
    for (const end of ends) expect(end).toBeLessThan(y + h - 10)
  })

  it('reports a bad source as an error', async () => {
    const result = await renderMermaidJsdom({ source: 'sequenceDiagram\n  A->>' })
    expect(result).toHaveProperty('error')
  })
})
