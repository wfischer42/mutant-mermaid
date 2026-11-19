/** The shared model for causal loop and stock & flow diagrams. */
import { uniqueIds } from '../../core/hooks.ts'
import type { Trend } from './trend.ts'

export type Polarity = '+' | '-' | '?'
export type LoopKind = 'R' | 'B'

export interface Link {
  from: string
  to: string
  polarity: Polarity
  delay: boolean
  /** 1-based source line, for diagnostics. */
  line: number
}

/** A `loop R "Name"` declaration, optionally pinned to its members. */
export interface LoopDecl {
  kind: LoopKind | null
  /** An explicit number from `R1`, or null for `R`. */
  number: number | null
  name: string
  members: string[]
  line: number
}

export interface Flow {
  id: string
  /** A stock id, or null for a cloud. */
  from: string | null
  to: string | null
  line: number
}

export interface SystemsModel {
  title: string
  mode: 'cld' | 'stockflow'
  /** Every variable in order of first mention. */
  variables: string[]
  links: Link[]
  loops: LoopDecl[]
  stocks: string[]
  flows: Flow[]
  auxes: string[]
  /** Display text for ids written with underscores. */
  labels: Record<string, string>
  /** Variable types from `kind Name: A, B`, in the order they're declared. */
  kinds: { name: string; members: string[] }[]
  /** Behaviour over time from `trend X: grow`, by variable name or loop tag. */
  trends: Record<string, Trend>
}

/** Each link's id for the host app, by link index: `A->B`, counted for repeats. */
export function linkIds(links: Link[]): string[] {
  const next = uniqueIds()
  return links.map((l) => next(`${l.from}->${l.to}`))
}

/** A detected elementary cycle with its classification. */
export interface Cycle {
  /** Nodes in travel order, starting from the smallest index. */
  nodes: string[]
  /** Indexes into the link list, one per step of the cycle. */
  links: number[]
  kind: LoopKind | null
}

/** A loop chosen for display, with its label. */
export interface NamedLoop {
  cycle: Cycle
  kind: LoopKind
  tag: string
  name: string
}
