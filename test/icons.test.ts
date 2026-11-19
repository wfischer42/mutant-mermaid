import { describe, expect, it } from 'vitest'
import { iconDiagnostics, splitIcons } from '../src/core/icons.ts'
import { splitNote } from '../src/core/parse.ts'
import { render } from '../src/index.ts'
import { textKit } from '../src/core/text.ts'
import { renderMermaidJsdom } from '../src/mermaid/jsdom.ts'

const kit = textKit({ font: 'nunito', family: 'Nunito' })

describe('icons', () => {
  it('splits known icons out of a line and leaves unknown names as text', () => {
    expect(splitIcons(':user: Ada :nope: x')).toEqual([{ icon: 'user' }, { text: 'Ada :nope: x' }])
  })

  it('measures an icon as wider than no icon and keeps :icon-names: whole when wrapping', () => {
    const style = { size: 14 }
    expect(kit.width(':user: Ada', style)).toBeGreaterThan(kit.width('Ada', style))
    expect(kit.wrap(':arrow-right: a b', { ...style, max: 30 })[0]).toContain(':arrow-right:')
  })

  it("doesn't split a note at the colon that closes an icon", () => {
    expect(splitNote(':globe: Web : public')).toEqual([':globe: Web', 'public'])
  })

  it('warns about an unknown name with the nearest real one', () => {
    const [warning] = iconDiagnostics('flowchart LR\n  a[:databse: Db]')
    expect(warning).toMatchObject({ line: 2, severity: 'warning' })
    expect(warning.message).toContain(':database:')
  })

  it('draws icons in our diagrams in place of the placeholder', async () => {
    const { svg } = await render('flowchart LR\n  a[:user: Ada] --> b[:database: Db]')
    expect(svg.match(/class="mm-icon"/g)).toHaveLength(2)
    expect(svg).not.toContain(':user:')
  })

  it('draws icons in Mermaid labels and architecture services', async () => {
    const sequence = await renderMermaidJsdom({ source: 'sequenceDiagram\n  participant A as :user: Ada\n  A->>A: hi' })
    if ('error' in sequence) throw new Error(sequence.error)
    expect(sequence.svg).toContain('class="mm-icon"')
    expect(sequence.svg).not.toContain(':user:')
    const architecture = await renderMermaidJsdom({ source: 'architecture-beta\n  service db(database)[Db]' })
    if ('error' in architecture) throw new Error(architecture.error)
    expect(architecture.svg).toContain('stroke="currentColor"')
  })
})
