import { describe, expect, it } from 'vitest'
import { parseFlowchart } from '../src/diagrams/flow/flowchart-parse.ts'
import { backEdges } from '../src/diagrams/flow/layout.ts'
import { cleanLabel, type FlowModel } from '../src/diagrams/flow/model.ts'
import { curve, pointAlong } from '../src/diagrams/flow/route.ts'
import type { Box } from '../src/diagrams/flow/shapes.ts'
import { straightenEdges } from '../src/diagrams/flow/straighten.ts'
import { parseState } from '../src/diagrams/flow/state-parse.ts'
import { render, tryRender } from '../src/index.ts'

function flow(source: string): FlowModel {
  const { model, diagnostics } = parseFlowchart(source)
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  if (!model) throw new Error('no model')
  return model
}

function shapes(model: FlowModel): Record<string, string> {
  return Object.fromEntries(model.nodes.map((n) => [n.id, n.shape]))
}

describe('flowchart parser', () => {
  it('reads the header direction in its several spellings', () => {
    expect(flow('flowchart LR\n  A').direction).toBe('LR')
    expect(flow('graph TD;\n  A').direction).toBe('TB')
    expect(flow('graph BT\n  A').direction).toBe('BT')
    expect(flow('flowchart\n  A').direction).toBe('TB')
  })

  it('reads every node shape', () => {
    const model = flow(`flowchart TD
      a[rect] --> b(rounded) --> c([stadium]) --> d[[sub]] --> e[(db)]
      f((circle)) --> g>flag] --> h{diamond} --> i{{hex}}
      j[/para/] --> k[\\alt\\] --> l[/trap\\] --> m[\\inv/] --> n(((double)))`)
    expect(shapes(model)).toEqual({
      a: 'rect',
      b: 'rounded',
      c: 'stadium',
      d: 'subroutine',
      e: 'cylinder',
      f: 'circle',
      g: 'flag',
      h: 'diamond',
      i: 'hexagon',
      j: 'parallelogram',
      k: 'parallelogramAlt',
      l: 'trapezoid',
      m: 'trapezoidAlt',
      n: 'doublecircle',
    })
    expect(model.nodes.find((n) => n.id === 'h')?.label).toBe('diamond')
  })

  it('reads quoted, markdown and broken labels', () => {
    const model = flow(
      'flowchart LR\n  A["Say (hi) [there]"] --> B["`**Bold** move`"]\n  C[one<br/>two]',
    )
    expect(model.nodes.map((n) => n.label)).toEqual(['Say (hi) [there]', 'Bold move', 'one\ntwo'])
    expect(cleanLabel('A #quot;quote#quot;')).toBe('A "quote"')
  })

  it('reads every link kind and its label', () => {
    const model = flow(`flowchart LR
      A --> B
      A --- C
      A -.-> D
      A -.- E
      A ==> F
      A === G
      A --o H
      A --x I
      A <--> J
      A -->|piped| K
      A -- inline --> L
      A -. dotted .-> M
      A == thick ==> N
      A ~~~ O`)
    const kinds = model.edges.map((e) => `${e.line}:${e.tail}>${e.head}:${e.label}`)
    expect(kinds).toEqual([
      'solid:none>arrow:',
      'solid:none>none:',
      'dotted:none>arrow:',
      'dotted:none>none:',
      'thick:none>arrow:',
      'thick:none>none:',
      'solid:none>circle:',
      'solid:none>cross:',
      'solid:arrow>arrow:',
      'solid:none>arrow:piped',
      'solid:none>arrow:inline',
      'dotted:none>arrow:dotted',
      'thick:none>arrow:thick',
      'invisible:none>none:',
    ])
  })

  it('expands chains and & groups', () => {
    const model = flow('flowchart TD\n  A --> B --> C\n  D & E --> F & G')
    expect(model.edges.map((e) => `${e.from}${e.to}`)).toEqual(['AB', 'BC', 'DF', 'DG', 'EF', 'EG'])
  })

  it('splits statements on semicolons', () => {
    const model = flow('graph LR; A-->B; B-->C;')
    expect(model.edges).toHaveLength(2)
  })

  it('nests subgraphs and moves nodes into the innermost one that mentions them', () => {
    const model = flow(`flowchart TB
      X --> A
      subgraph outer [Outer box]
        direction LR
        A --> B
        subgraph inner
          B --> C
        end
      end
      subgraph "Quoted title"
        D
      end
      C --> outer`)
    const parentOf = Object.fromEntries(model.nodes.map((n) => [n.id, n.parent]))
    expect(parentOf).toEqual({ X: null, A: 'outer', B: 'inner', C: 'inner', D: 'Quoted title' })
    expect(model.clusters.map((c) => [c.id, c.title, c.parent, c.direction])).toEqual([
      ['outer', 'Outer box', null, 'LR'],
      ['inner', 'inner', 'outer', undefined],
      ['Quoted title', 'Quoted title', null, undefined],
    ])
    expect(model.nodes.some((n) => n.id === 'outer')).toBe(false)
  })

  it('applies classDef, class, ::: and style', () => {
    const model = flow(`flowchart LR
      classDef hot fill:#f96,stroke:#333,stroke-width:4px
      A:::hot --> B
      class B,C hot
      style C fill:#bbf
      linkStyle 0 stroke:#ff3`)
    expect(model.classDefs.hot).toEqual({ fill: '#f96', stroke: '#333', 'stroke-width': '4px' })
    expect(model.nodes.map((n) => n.classes)).toEqual([['hot'], ['hot']])
    expect(model.edges[0].style.stroke).toBe('#ff3')
  })

  it('warns about what it cannot read without failing', () => {
    const { model, diagnostics } = parseFlowchart(
      'flowchart LR\n  A --> B\n  A -> ?? B\n  click A callback\n  end',
    )
    expect(model?.nodes).toHaveLength(2)
    expect(diagnostics.map((d) => [d.line, d.severity])).toEqual([
      [3, 'warning'],
      [5, 'warning'],
    ])
  })

  it('accepts link ids and skips their property lines', () => {
    const { model, diagnostics } = parseFlowchart(
      'flowchart TD\n  A e1@==> B e2@-- yes --> C\n  e1@{ animate: true }',
    )
    expect(diagnostics).toEqual([])
    expect(model?.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C'])
    expect(model?.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ['A', 'B', ''],
      ['B', 'C', 'yes'],
    ])
  })

  it('warns about a shape name it does not know, and draws a rectangle', () => {
    const { model, diagnostics } = parseFlowchart(
      'flowchart TD\n  A@{ shape: doc, label: "Report" }',
    )
    expect(model?.nodes[0]).toMatchObject({ shape: 'rect', label: 'Report' })
    expect(diagnostics.map((d) => [d.line, d.message.slice(0, 22)])).toEqual([
      [2, `There's no "doc" shape`],
    ])
  })

  it('finds the edges that close cycles, in source order', () => {
    const model = flow('flowchart LR\n  A --> B --> C --> A\n  C --> D')
    expect([...backEdges(model)]).toEqual([2])
  })
})

describe('state diagram parser', () => {
  it('reads states, pseudo-states, composites, choices and notes', () => {
    const { model, diagnostics } = parseState(`stateDiagram-v2
      direction LR
      [*] --> Idle
      Idle --> Busy : start
      state "Waiting for I/O" as Wait
      Busy --> Wait
      state Busy {
        [*] --> Working
        Working --> [*]
      }
      state pick <<choice>>
      Wait --> pick
      pick --> Idle : done
      Idle : Doing nothing
      note right of Idle : cheap
      Idle --> [*]`)
    expect(diagnostics).toEqual([])
    if (!model) throw new Error('no model')
    expect(model.direction).toBe('LR')
    const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]))
    expect(byId.__start_root.shape).toBe('start')
    expect(byId.__end_root.shape).toBe('end')
    expect(byId.__start_Busy.parent).toBe('Busy')
    expect(byId.Wait.label).toBe('Waiting for I/O')
    expect(byId.Idle.label).toBe('Doing nothing')
    expect(byId.pick.shape).toBe('choice')
    expect(byId.__note_1.shape).toBe('note')
    expect(model.clusters.map((c) => c.id)).toEqual(['Busy'])
    expect(model.edges.find((e) => e.to === 'Busy')?.label).toBe('start')
  })

  it('draws a block note missing its end note, and warns at the note', () => {
    const { model, diagnostics } = parseState(
      'stateDiagram-v2\n  [*] --> A\n  note right of A\n    hello\n  A --> B',
    )
    expect(model?.nodes.find((n) => n.shape === 'note')?.label).toBe('hello\nA --> B')
    expect(diagnostics.map((d) => d.line)).toEqual([3])
  })

  it('puts each concurrent region in its own boxless cluster, with its own start', () => {
    const { model, diagnostics } = parseState(
      'stateDiagram-v2\n  state Active {\n    [*] --> X\n    --\n    [*] --> Y\n  }',
    )
    expect(diagnostics).toEqual([])
    expect(model?.edges.map((e) => [e.from, e.to])).toEqual([
      ['__start_Active', 'X'],
      ['__start_Active_r1', 'Y'],
    ])
    expect(model?.clusters.map((c) => [c.id, c.parent, Boolean(c.region)])).toEqual([
      ['Active', null, false],
      ['Active__region0', 'Active', true],
      ['Active__region1', 'Active', true],
    ])
    const parents = Object.fromEntries(model?.nodes.map((n) => [n.id, n.parent]) ?? [])
    expect([parents.X, parents.Y]).toEqual(['Active__region0', 'Active__region1'])
  })

  it('draws a dashed divider between regions, side by side, in source order', async () => {
    const { svg } = await render(
      'stateDiagram-v2\n  state Active {\n    [*] --> Num\n    --\n    [*] --> Caps\n    --\n    [*] --> Scroll\n  }',
    )
    expect(svg.match(/stroke-dasharray="6 5"/g)).toHaveLength(2)
    const x = (word: string) => Number(new RegExp(`x="([\\d.]+)"[^>]*>${word}<`).exec(svg)?.[1])
    expect(x('Num')).toBeLessThan(x('Caps'))
    expect(x('Caps')).toBeLessThan(x('Scroll'))
  })

  it('warns about a region line outside any composite', () => {
    const { diagnostics } = parseState('stateDiagram-v2\n  [*] --> X\n  --\n  [*] --> Y')
    expect(diagnostics.map((d) => d.line)).toEqual([3])
  })

  it('warns about a composite missing its closing brace', () => {
    const { diagnostics } = parseState('stateDiagram-v2\n  state Busy {\n    [*] --> X')
    expect(diagnostics.map((d) => [d.line, d.message])).toEqual([
      [3, '`state Busy {` is missing its `}`; add one after its last line.'],
    ])
  })
})

describe('render', () => {
  it('draws a flowchart deterministically', async () => {
    const source = 'flowchart LR\n  A[Start] --> B{Ok?}\n  B -->|yes| C([Done])\n  B -.->|no| A'
    const a = await render(source)
    const b = await render(source)
    expect(a.kind).toBe('flowchart')
    expect(a.svg).toBe(b.svg)
    expect(a.svg.match(/class="node"/g)).toHaveLength(3)
    expect(a.svg).toContain('yes')
  })

  it('draws subgraphs, dark mode and a state diagram', async () => {
    const flowResult = await render(
      'graph TD\n  subgraph one [One]\n    A --> B\n  end\n  B --> C',
      { dark: true },
    )
    expect(flowResult.svg).toContain('class="cluster"')
    const state = await render('stateDiagram-v2\n  [*] --> A\n  A --> [*]')
    expect(state.kind).toBe('state')
  })

  it('keeps the two labels of a two-way link apart', async () => {
    for (const source of [
      'flowchart LR\n  A -->|request sent| B\n  B -->|response back| A',
      'stateDiagram-v2\n  A --> B : go forward now\n  B --> A : come back again',
    ]) {
      const { svg } = await render(source)
      const boxes = [
        ...svg.matchAll(
          /class="edge-label"><rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g,
        ),
      ].map((m) => m.slice(1).map(Number))
      expect(boxes).toHaveLength(2)
      const [[ax, ay, aw, ah], [bx, by, bw, bh]] = boxes
      const apart = ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay
      expect(apart).toBe(true)
    }
  })

  it('reports an empty flowchart', async () => {
    const result = await tryRender('flowchart LR')
    expect('error' in result && result.error).toMatch(/at least one node/)
  })
})

describe('straightenEdges', () => {
  const [edge] = flow('flowchart TD\n  A --> B').edges
  const layoutWith = (points: { x: number; y: number }[], blockers: [string, Box][] = []) => ({
    width: 400,
    height: 400,
    nodes: new Map<string, Box>([
      ['A', { x: 0, y: 0, w: 120, h: 40 }],
      ['B', { x: 0, y: 200, w: 120, h: 40 }],
      ...blockers,
    ]),
    clusters: new Map<string, Box>(),
    edges: [{ edge, points }],
  })
  const nearly = [
    { x: 60, y: 40 },
    { x: 60, y: 120 },
    { x: 72, y: 120 },
    { x: 72, y: 200 },
  ]

  it('slides the target end to make a nearly straight route straight', () => {
    expect(straightenEdges(layoutWith(nearly))[0].points).toEqual([
      { x: 60, y: 40 },
      { x: 60, y: 200 },
    ])
  })

  it('leaves the route alone where the straight line would cross a node', () => {
    const blocked = layoutWith(nearly, [['C', { x: 40, y: 100, w: 30, h: 10 }]])
    expect(straightenEdges(blocked)[0].points).toBe(nearly)
  })
})

describe('curve', () => {
  const curvedPath = (points: { x: number; y: number }[]) => curve(points).d
  const curves = (d: string) => d.match(/C/g)?.length ?? 0

  it('samples the drawn line so a label at its middle sits on the curve', () => {
    const { line } = curve([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ])
    expect(line.at(-1)).toEqual({ x: 100, y: 100 })
    const mid = pointAlong({ points: line, fraction: 0.5 })
    expect(Math.abs(mid.x - 50)).toBeLessThan(5)
    expect(Math.abs(mid.y - 50)).toBeLessThan(5)
  })

  it('draws a jog as one S that ends where the route does', () => {
    const d = curvedPath([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ])
    expect(curves(d)).toBe(1)
    expect(d.endsWith('L100 100')).toBe(true)
  })

  it('folds a jog that steps a little way back into one S of their net step', () => {
    const zigzag = (back: number) =>
      curvedPath([
        { x: 0, y: 200 },
        { x: 0, y: 150 },
        { x: -40, y: 150 },
        { x: -40, y: 80 },
        { x: -40 + back, y: 80 },
        { x: -40 + back, y: 0 },
      ])
    expect(curves(zigzag(15))).toBe(1)
    expect(zigzag(15).endsWith('L-25 0')).toBe(true)
    expect(curves(zigzag(30))).toBe(2)
  })

  it('draws a step too small to see as a straight slant', () => {
    const d = curvedPath([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 4, y: 50 },
      { x: 4, y: 100 },
    ])
    expect(curves(d)).toBe(0)
  })

  it('rounds a single corner and leaves straight lines alone', () => {
    expect(curves(curvedPath([{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 80, y: 80 }]))).toBe(1)
    expect(curvedPath([{ x: 0, y: 0 }, { x: 0, y: 80 }])).toBe('M0 0L0 80')
  })
})
