// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { idMaker } from '../src/core/hooks.ts'
import { bind, highlight, parseClick, render } from '../src/index.ts'

describe('click lines', () => {
  it('reads each of Mermaid’s forms', () => {
    expect(parseClick('click A openCard')).toEqual({
      id: 'A',
      hook: { action: 'openCard', args: [] },
    })
    expect(parseClick('click A call openCard("auth, v2", 2) "Open it"')).toEqual({
      id: 'A',
      hook: { action: 'openCard', args: ['auth, v2', '2'], tip: 'Open it' },
    })
    expect(parseClick('click A href "/docs" "Docs" _blank')).toEqual({
      id: 'A',
      hook: { action: 'href', args: ['/docs', '_blank'], tip: 'Docs' },
    })
    expect(parseClick('click A "/docs"')).toEqual({
      id: 'A',
      hook: { action: 'href', args: ['/docs'] },
    })
  })

  it('leaves lines that only start with click alone', () => {
    expect(parseClick('click A')).toBeNull()
    expect(parseClick('click A href')).toBeNull()
    expect(parseClick('click A open "tip" extra words')).toBeNull()
  })

  it('makes label ids that hold when other parts change', () => {
    const next = idMaker()
    expect(['Launch day!', 'Beta', 'Launch day'].map(next)).toEqual([
      'launch-day',
      'beta',
      'launch-day-2',
    ])
  })
})

describe('tagged parts', () => {
  const source = [
    'flowchart LR',
    '  A[Auth] e1@--> B[Billing]',
    '  B -->|retry| A',
    '  click A call openCard("auth") "Auth service"',
    '  click e1 href "/flows/auth"',
  ].join('\n')

  it('tags nodes and edges and writes hooks onto them', async () => {
    const { svg, diagnostics } = await render(source)
    expect(diagnostics).toEqual([])
    expect(tagOf({ svg, id: 'A' })).toMatchObject({
      'data-mm-kind': 'node',
      'data-mm-action': 'openCard',
      'data-mm-args': '[&quot;auth&quot;]',
      style: expect.stringMatching(/^--mm-tint:#[0-9a-f]{6}$/),
    })
    expect(svg).toMatch(/data-mm-id="A"[^>]*><title>Auth service<\/title>/)
    expect(tagOf({ svg, id: 'e1' })).toMatchObject({ 'data-mm-action': 'href' })
    expect(tagOf({ svg, id: 'B-&gt;A' })).toMatchObject({ 'data-mm-kind': 'edge' })
    expect(svg).toContain('[data-mm-action]{cursor:pointer}')
  })

  it('draws the same with or without click lines', async () => {
    const plain = await render(source.split('\n').slice(0, 3).join('\n'))
    const hooked = await render(source)
    const strip = (svg: string) =>
      svg
        .replace(/ data-mm-(action|args)="[^"]*"/g, '')
        .replace(/<title>[^<]*<\/title>/g, '')
        .replace('[data-mm-action]{cursor:pointer}', '')
    expect(strip(hooked.svg)).toBe(plain.svg)
  })

  it('warns about a click on an id the diagram lacks', async () => {
    const { diagnostics } = await render('flowchart LR\n  A --> B\n  click C openCard')
    expect(diagnostics).toEqual([
      expect.objectContaining({
        line: 3,
        severity: 'warning',
        message: expect.stringContaining('Ids here: A->B, A, B.'),
      }),
    ])
  })

  it('reports clicks and hovers to the host app', async () => {
    const root = document.createElement('div')
    root.innerHTML = (await render(source)).svg
    document.body.append(root)
    const openCard = vi.fn()
    const onEnter = vi.fn()
    const onLeave = vi.fn()
    const unbind = bind(root, { actions: { openCard }, onEnter, onLeave })
    const label = root.querySelector('[data-mm-id="A"] text')
    label?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(openCard).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'A',
        kind: 'node',
        args: ['auth'],
        tint: expect.stringMatching(/^#[0-9a-f]{6}$/),
      }),
    )
    label?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    root
      .querySelector('[data-mm-id="B"]')
      ?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(onEnter.mock.calls.map(([p]) => p.id)).toEqual(['A', 'B'])
    expect(onLeave.mock.calls.map(([p]) => p.id)).toEqual(['A'])
    highlight({ root, ids: ['B'] })
    expect(
      [...root.querySelectorAll('[data-mm-active]')].map((el) => el.getAttribute('data-mm-id')),
    ).toEqual(['B'])
    unbind()
    label?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(openCard).toHaveBeenCalledTimes(1)
  })
})

/** Each part's kind by id, in drawing order. */
function parts(svg: string): Record<string, string> {
  const found = svg.matchAll(/data-mm-id="([^"]*)" data-mm-kind="([^"]*)"/g)
  return Object.fromEntries([...found].map(([, id, kind]) => [id.replace(/&gt;/g, '>'), kind]))
}

/** The attributes of the first part tagged `id` (as escaped in the markup), in any order. */
function tagOf({ svg, id }: { svg: string; id: string }): Record<string, string> {
  const quoted = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tag = new RegExp(`<g\\b[^>]* data-mm-id="${quoted}"[^>]*>`).exec(svg)?.[0] ?? ''
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))
}

describe('systems and wireframe parts', () => {
  it('tags variables, links and loops in a causal loop diagram', async () => {
    const { svg, diagnostics } = await render(
      [
        'cld',
        '  Adopters -> "Word of mouth" : +',
        '  "Word of mouth" -> Adopters : +',
        '  loop R "Spread"',
        '  click "Word of mouth" openCard',
        '  click R1 explainLoop',
      ].join('\n'),
    )
    expect(diagnostics).toEqual([])
    expect(parts(svg)).toMatchObject({
      Adopters: 'variable',
      'Word of mouth': 'variable',
      'Adopters->Word of mouth': 'link',
      R1: 'loop',
    })
    expect(tagOf({ svg, id: 'Word of mouth' })).toMatchObject({ 'data-mm-action': 'openCard' })
    expect(tagOf({ svg, id: 'R1' })).toMatchObject({ 'data-mm-action': 'explainLoop' })
  })

  it('tags stocks, flows, auxiliaries and links in a stock and flow diagram', async () => {
    const { svg } = await render(
      [
        'stockflow',
        '  stock Customers',
        '  flow churn : Customers -> cloud',
        '  aux churn_rate',
        '  churn_rate -> churn : +',
      ].join('\n'),
    )
    expect(parts(svg)).toMatchObject({
      Customers: 'stock',
      churn: 'flow',
      churn_rate: 'aux',
      'churn_rate->churn': 'link',
    })
  })

  it('names wireframe elements by id=, then text, then kind', async () => {
    const { svg, diagnostics } = await render(
      [
        'wireframe device=phone',
        '  card Starter',
        '    button Start trial id=start',
        '    button Start trial',
        '    divider',
        '  click start openCheckout',
      ].join('\n'),
    )
    expect(diagnostics).toEqual([])
    expect(parts(svg)).toMatchObject({
      starter: 'card',
      start: 'button',
      'start-trial': 'button',
      divider: 'divider',
    })
    expect(tagOf({ svg, id: 'start' })).toMatchObject({ 'data-mm-action': 'openCheckout' })
  })
})

describe('mindmap and timeline parts', () => {
  it('lays a hit box over every mindmap node, in each style', async () => {
    for (const style of ['cards', 'organic']) {
      const { svg, diagnostics } = await render(
        [
          `mindmap "Trip to Japan" style=${style}`,
          '  Kyoto id=kyoto',
          '    Fushimi Inari',
          '  Tokyo',
          '    Fushimi Inari',
          '  ~ Kyoto -- "day trip" --> Tokyo',
          '  click kyoto openCard',
        ].join('\n'),
      )
      expect(diagnostics).toEqual([])
      expect(parts(svg)).toEqual({
        'trip-to-japan': 'node',
        kyoto: 'node',
        'fushimi-inari': 'node',
        tokyo: 'node',
        'fushimi-inari-2': 'node',
        'kyoto->tokyo': 'link',
      })
      expect(tagOf({ svg, id: 'kyoto' })).toMatchObject({ 'data-mm-action': 'openCard' })
      expect(svg).toMatch(/data-mm-id="kyoto"[^>]*><rect [^>]*fill-opacity="0"/)
    }
  })

  it('tags argument and issue tree nodes', async () => {
    const argue = await render('argue "Ship it"\n  + Users asked\n  - Not tested')
    expect(parts(argue.svg)).toEqual({
      'ship-it': 'claim',
      'users-asked': 'support',
      'not-tested': 'attack',
    })
    const issues = await render('issues "Why churn?"\n  Price\n  Fit')
    expect(parts(issues.svg)).toEqual({ 'why-churn': 'issue', price: 'issue', fit: 'issue' })
  })

  it('tags dated events and spans in either direction', async () => {
    for (const direction of ['horizontal', 'vertical']) {
      const { svg, diagnostics } = await render(
        [
          `timeline "Plan" now=2026 direction=${direction}`,
          '  lane Platform',
          '    span Storage rewrite 2026-01 .. 2026-04',
          '    event Launch 2026-09 id=ga',
          '  click ga openCard',
        ].join('\n'),
      )
      expect(diagnostics).toEqual([])
      expect(parts(svg)).toMatchObject({ 'storage-rewrite': 'span', ga: 'event' })
      expect(tagOf({ svg, id: 'ga' })).toMatchObject({ 'data-mm-action': 'openCard' })
    }
  })

  it('tags Mermaid periods and their events in either direction', async () => {
    for (const head of ['timeline', 'timeline TD']) {
      const { svg } = await render(
        `${head}\n  Week 1 : Interviews : Teardown\n  Week 2 : Interviews`,
      )
      expect(parts(svg)).toEqual({
        'week-1': 'period',
        interviews: 'event',
        teardown: 'event',
        'week-2': 'period',
        'interviews-2': 'event',
      })
    }
  })
})
