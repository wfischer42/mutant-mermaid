import type { Diagnostic } from '../../core/parse.ts'
import type { Cycle, Link, LoopDecl, LoopKind, NamedLoop } from './model.ts'

const LIMIT = 2000

interface Step {
  to: number
  link: number
}

interface Search {
  start: number
  adjacency: Step[][]
  onPath: boolean[]
  nodes: number[]
  links: number[]
  out: { nodes: number[]; links: number[] }[]
}

/** Extends the current path from `at`, recording every way back to the start. */
function extend({ search, at }: { search: Search; at: number }): void {
  for (const { to, link } of search.adjacency[at]) {
    if (search.out.length >= LIMIT) return
    if (to === search.start) {
      search.out.push({ nodes: [...search.nodes], links: [...search.links, link] })
      continue
    }
    if (to < search.start || search.onPath[to]) continue
    search.onPath[to] = true
    search.nodes.push(to)
    search.links.push(link)
    extend({ search, at: to })
    search.onPath[to] = false
    search.nodes.pop()
    search.links.pop()
  }
}

/** Whether a loop with these link polarities reinforces (even count of −) or balances (odd). */
export function classify(polarities: string[]): LoopKind | null {
  if (polarities.includes('?')) return null
  return polarities.filter((p) => p === '-').length % 2 ? 'B' : 'R'
}

/**
 * Every elementary cycle of the directed graph, each starting from its lowest-indexed node, found
 * by depth-first search restricted to nodes after the start (so each cycle is found once). Fine
 * for the dozens of variables a readable diagram has; stops at 2000 cycles.
 * `unknownAs` decides how a link without polarity counts.
 */
export function findCycles({
  nodes,
  links,
  unknownAs = '?',
}: {
  nodes: string[]
  links: Link[]
  unknownAs?: '+' | '?'
}): Cycle[] {
  const index = new Map(nodes.map((name, i) => [name, i]))
  const adjacency: Step[][] = nodes.map(() => [])
  links.forEach((link, i) => {
    const from = index.get(link.from)
    const to = index.get(link.to)
    if (from === undefined || to === undefined) return
    adjacency[from].push({ to, link: i })
  })
  const found: { nodes: number[]; links: number[] }[] = []
  for (let start = 0; start < nodes.length; start++) {
    const search: Search = {
      start,
      adjacency,
      onPath: nodes.map((_, i) => i === start),
      nodes: [start],
      links: [],
      out: found,
    }
    extend({ search, at: start })
  }
  return found.map((cycle) => ({
    nodes: cycle.nodes.map((i) => nodes[i]),
    links: cycle.links,
    kind: classify(
      cycle.links.map((i) => (links[i].polarity === '?' ? unknownAs : links[i].polarity)),
    ),
  }))
}

/** Shorter loops first, then those whose links come earliest in the source. */
export function byImportance({ cycles, links }: { cycles: Cycle[]; links: Link[] }): Cycle[] {
  const firstLine = (cycle: Cycle) => Math.min(...cycle.links.map((i) => links[i].line))
  const keyed = cycles.map((cycle) => ({ cycle, size: cycle.nodes.length, line: firstLine(cycle) }))
  keyed.sort((left, right) => left.size - right.size || left.line - right.line)
  return keyed.map((k) => k.cycle)
}

function sameMembers({ cycle, members }: { cycle: Cycle; members: string[] }): boolean {
  const set = new Set(cycle.nodes)
  return set.size === new Set(members).size && members.every((m) => set.has(m))
}

function linkKey(link: Link): string {
  return `${link.from}\u0000${link.to}`
}

interface Assigned {
  decl: LoopDecl | null
  cycle: Cycle
}

/** Matches declarations to cycles: pinned ones by members, the rest in order by type. */
function assign({
  decls,
  ranked,
  diagnostics,
}: {
  decls: LoopDecl[]
  ranked: Cycle[]
  diagnostics: Diagnostic[]
}): Assigned[] {
  const taken = new Set<Cycle>()
  const out: Assigned[] = []
  for (const decl of decls.filter((d) => d.members.length)) {
    const cycle = ranked.find(
      (c) => !taken.has(c) && sameMembers({ cycle: c, members: decl.members }),
    )
    if (!cycle) {
      diagnostics.push({
        line: decl.line,
        message: `No loop runs through exactly ${decl.members.join(', ')}. Check the names and the link directions.`,
        severity: 'warning',
      })
      continue
    }
    taken.add(cycle)
    out.push({ decl, cycle })
  }
  for (const decl of decls.filter((d) => !d.members.length)) {
    const free = ranked.filter((c) => !taken.has(c))
    const cycle = free.find((c) => decl.kind === null || c.kind === decl.kind) ?? free[0]
    if (!cycle) {
      diagnostics.push({
        line: decl.line,
        message: `There's no loop left to call "${decl.name}"; the links form ${ranked.length} loop(s).`,
        severity: 'warning',
      })
      continue
    }
    taken.add(cycle)
    out.push({ decl, cycle })
  }
  const order = (a: Assigned) => (a.decl ? decls.indexOf(a.decl) : decls.length)
  out.sort((left, right) => order(left) - order(right))
  return out
}

function kindWord(kind: LoopKind): string {
  return kind === 'R' ? 'reinforcing' : 'balancing'
}

/** Warns where a declared R or B disagrees with the polarity the links give. */
function checkKinds({
  assigned,
  diagnostics,
}: {
  assigned: Assigned[]
  diagnostics: Diagnostic[]
}): void {
  for (const { decl, cycle } of assigned) {
    if (!decl?.kind || !cycle.kind || decl.kind === cycle.kind) continue
    diagnostics.push({
      line: decl.line,
      message: `Loop "${decl.name || decl.kind}" is declared ${kindWord(decl.kind)}, but its links (${cycle.nodes.join(' → ')}) make it ${kindWord(cycle.kind)}.`,
      severity: 'warning',
    })
  }
}

/**
 * Picks the loops to label: every declared loop, then the most important undeclared ones until
 * each link that lies on some loop belongs to a labelled one. Numbers R1, B1… by type in that
 * order, keeping explicit numbers. A loop's letter follows its links even when declared otherwise.
 */
export function chooseLoops({
  cycles,
  links,
  decls,
}: {
  cycles: Cycle[]
  links: Link[]
  decls: LoopDecl[]
}): { loops: NamedLoop[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const ranked = byImportance({ cycles, links })
  const assigned = assign({ decls, ranked, diagnostics })
  checkKinds({ assigned, diagnostics })
  const covered = new Set<string>()
  const cover = (cycle: Cycle) => {
    for (const i of cycle.links) covered.add(linkKey(links[i]))
  }
  for (const a of assigned) cover(a.cycle)
  const used = new Set(assigned.map((a) => a.cycle))
  for (const cycle of ranked) {
    if (used.has(cycle) || !cycle.kind) continue
    if (cycle.links.every((i) => covered.has(linkKey(links[i])))) continue
    cover(cycle)
    used.add(cycle)
    assigned.push({ decl: null, cycle })
  }
  const explicit = new Set(
    assigned.flatMap(({ decl, cycle }) => {
      const kind = cycle.kind ?? decl?.kind
      return decl?.number && kind ? [`${kind}${decl.number}`] : []
    }),
  )
  const counters: Record<LoopKind, number> = { R: 0, B: 0 }
  const nextTag = (kind: LoopKind) => {
    do counters[kind]++
    while (explicit.has(`${kind}${counters[kind]}`))
    return `${kind}${counters[kind]}`
  }
  const loops = assigned.map(({ decl, cycle }) => {
    const kind: LoopKind = cycle.kind ?? decl?.kind ?? 'R'
    const tag = decl?.number ? `${kind}${decl.number}` : nextTag(kind)
    return { cycle, kind, tag, name: decl?.name ?? '' }
  })
  return { loops, diagnostics }
}
