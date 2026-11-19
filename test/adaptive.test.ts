import { describe, expect, it } from 'vitest'
import { adaptive } from '../src/adaptive.ts'
import { inlineImg } from '../src/inline.ts'
import { renderAuto } from '../src/node.ts'

const light =
  '<svg viewBox="0 0 10 10"><rect fill="#ffffff" stroke="#123"/><path fill="url(#abc)" opacity="0.6"/><text fill="#ffffff">Issue #123</text></svg>'
const dark =
  '<svg viewBox="0 0 10 10"><rect fill="#000000" stroke="#123"/><path fill="url(#abc)" opacity="1"/><text fill="#000000">Issue #123</text></svg>'

describe('adaptive', () => {
  it('turns colors and opacities that differ into variables, one per light and dark pair', () => {
    const made = adaptive({ light, dark })
    expect(made?.palettes).toEqual({
      light: { '--mm-c0': '#ffffff', '--mm-c1': '0.6' },
      dark: { '--mm-c0': '#000000', '--mm-c1': '1' },
    })
    expect(made?.svg).toContain('<rect fill="var(--mm-c0)" stroke="#123"/>')
    expect(made?.svg).toContain('fill="url(#abc)" opacity="var(--mm-c1)"')
    expect(made?.svg).toContain('Issue #123')
    expect(made?.svg).toContain(
      `svg.${made?.scope}{--mm-c0:#ffffff;--mm-c1:0.6}@media (prefers-color-scheme: dark){svg.${made?.scope}{--mm-c0:#000000;--mm-c1:1}}`,
    )
    expect(made?.svg).toMatch(new RegExp(`^<svg class="${made?.scope}" viewBox`))
  })

  it('gives up when the renders do not line up, or nothing differs', () => {
    expect(adaptive({ light, dark: dark.replace(' stroke="#123"', '') })).toBeNull()
    expect(adaptive({ light, dark: light })).toBeNull()
  })

  it('makes every kind of drawing adaptive, ours and Mermaid alike', async () => {
    for (const source of ['pyramid "P"\n  A\n  B', 'sequenceDiagram\n  Alice->>Bob: Hi']) {
      const [l, d] = await Promise.all([renderAuto(source), renderAuto(source, { dark: true })])
      expect(adaptive({ light: l.svg, dark: d.svg })).not.toBeNull()
    }
  })

  it('inlines with a script that follows the chat setting', () => {
    const made = adaptive({ light, dark })
    if (!made) throw new Error('not adaptive')
    const tag = inlineImg(made)
    expect(tag).toMatch(new RegExp(`^<img id="${made.scope}" `))
    expect(tag).toContain('dataset.mode')
    expect(tag).toContain(JSON.stringify(made.palettes))
  })
})
