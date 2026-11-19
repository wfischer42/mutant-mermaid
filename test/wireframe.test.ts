import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { textKit } from '../src/core/text.ts'
import { place } from '../src/diagrams/wireframe/layout.ts'
import { parseWireframe, readParts } from '../src/diagrams/wireframe/parse.ts'
import { gather } from '../src/diagrams/wireframe/wireframe.ts'
import { render } from '../src/index.ts'

const examples = join(import.meta.dirname, '../examples/wireframe')
const env = { kit: textKit({ font: 'nunito', family: 'Nunito' }) }

describe('wireframe parsing', () => {
  it('reads the device, nesting, notes and flags', () => {
    const { model, diagnostics } = parseWireframe(
      'wireframe "Sign in" device=phone\n  card Login\n    input Email : you@example.com\n    button Go !primary',
    )
    expect(diagnostics).toEqual([])
    expect(model?.device).toBe('phone')
    expect(model?.width).toBe(375)
    const card = model?.elements[0]
    expect(card?.kind).toBe('card')
    expect(card?.children[0]).toMatchObject({
      kind: 'input',
      label: 'Email',
      note: 'you@example.com',
    })
    expect(card?.children[1].flags.has('primary')).toBe(true)
  })

  it('marks quoted labels to be shown as written', () => {
    const { model } = parseWireframe('wireframe\n  text "Free trial"\n  text Free trial')
    expect(model?.elements.map((e) => e.flags.has('literal'))).toEqual([true, false])
    expect(model?.elements[0].label).toBe('Free trial')
  })

  it('keeps @ and colons in labels outside fields', () => {
    const { model } = parseWireframe(
      'wireframe\n  text Meet @ 3pm\n  image user@5x.png\n  card Plan: Pro',
    )
    expect(model?.elements.map((e) => e.label)).toEqual(['Meet @ 3pm', 'user@5x.png', 'Plan: Pro'])
  })

  it('warns about ignored colors and children of widgets', () => {
    const { diagnostics } = parseWireframe(
      'wireframe\n  badge New #green\n  button Go\n    text Lost',
    )
    expect(diagnostics.map((d) => [d.line, d.severity])).toEqual([
      [2, 'warning'],
      [3, 'warning'],
    ])
  })

  it('keeps colons in text labels', () => {
    const { model } = parseWireframe('wireframe\n  text Note: saved')
    expect(model?.elements[0].label).toBe('Note: saved')
  })

  it('maps aliases and implied flags', () => {
    const { model } = parseWireframe('wireframe\n  password Secret\n  checkbox Agree\n  navbar')
    expect(model?.elements.map((e) => e.kind)).toEqual(['input', 'check', 'header'])
    expect(model?.elements[0].flags.has('secret')).toBe(true)
  })

  it('splits parts and marks bracketed ones', () => {
    expect(readParts('Home | [Pricing] | Docs')).toEqual([
      { text: 'Home', marked: false },
      { text: 'Pricing', marked: true },
      { text: 'Docs', marked: false },
    ])
  })

  it('reads table rows as parts', () => {
    const { model } = parseWireframe('wireframe\n  table\n    A | B\n    1 | 2')
    expect(model?.elements[0].rows.map((r) => r.map((p) => p.text))).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ])
  })

  it('warns about unknown elements and draws them as text', () => {
    const { model, diagnostics } = parseWireframe('wireframe\n  carousel Photos')
    expect(model?.elements[0]).toMatchObject({ kind: 'text', label: 'carousel Photos' })
    expect(diagnostics[0]).toMatchObject({ line: 2, severity: 'warning' })
  })

  it('needs elements', () => {
    expect(parseWireframe('wireframe "Empty"').diagnostics[0].severity).toBe('error')
  })
})

describe('wireframe layout', () => {
  it('gathers ordinary elements between header and footer into one main column', () => {
    const { model } = parseWireframe(
      'wireframe\n  header\n    logo\n  text A\n  text B\n  footer\n    text C',
    )
    expect(gather(model?.elements ?? []).map((e) => e.kind)).toEqual(['header', 'main', 'footer'])
  })

  it('gives growing children of a row the space the fixed ones leave', () => {
    const { model } = parseWireframe('wireframe\n  row\n    input Search\n    button Go')
    const el = model?.elements[0]
    if (!el) throw new Error('no row')
    const box = place({ env, el, x: 0, y: 0, w: 400, align: 'start' })
    const [input, button] = box.kids
    expect(input.w + button.w + 12).toBeCloseTo(400)
    expect(button.x).toBeCloseTo(input.w + 12)
  })

  it('pushes a header’s last child to the far edge', () => {
    const { model } = parseWireframe('wireframe\n  header\n    logo\n    button Sign in')
    const el = model?.elements[0]
    if (!el) throw new Error('no header')
    const box = place({ env, el, x: 0, y: 0, w: 600, align: 'start' })
    const last = box.kids[1]
    expect(last.x + last.w).toBeCloseTo(580)
  })
})

describe('wireframe examples', () => {
  for (const file of readdirSync(examples).filter((f) => f.endsWith('.mmd'))) {
    it(`renders ${file} without diagnostics`, async () => {
      const result = await render(readFileSync(join(examples, file), 'utf8'))
      expect(result.kind).toBe('wireframe')
      expect(result.diagnostics).toEqual([])
      expect(result.svg).toContain('<svg')
    })
  }
})
