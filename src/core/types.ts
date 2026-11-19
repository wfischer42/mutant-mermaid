import type { Tokens } from '../theme/index.ts'
import type { Diagnostic } from './parse.ts'
import type { Rng } from './rng.ts'
import type { TextKit } from './text.ts'

/** What a diagram's renderer is handed besides its model. */
export interface Context {
  tokens: Tokens
  text: TextKit
  /** Seeded from the source text: the same source always draws the same. */
  rng: Rng
  /** Settings from the frontmatter, such as `look` or diagram-specific options. */
  options: Record<string, string>
}

/** A rendered diagram before it's wrapped in an <svg> document. */
export interface Drawing {
  width: number
  height: number
  body: string
  defs?: string
  css?: string
  title?: string
  /**
   * Set when the drawing is meant to be scrolled along one axis rather than shrunk to fit, such as
   * a long timeline. Viewers show it at full size; parts marked `data-sticky` stay in view.
   */
  scroll?: 'x' | 'y'
  /** What drawing found that parsing couldn't, such as links that came out tangled. */
  diagnostics?: Diagnostic[]
}

export interface Parsed<M> {
  model: M | null
  diagnostics: Diagnostic[]
}

/** What an agent needs to write a type's source without reading this repo. */
export interface Guide {
  /** The shape of idea that calls for this type, in a line. */
  useWhen: string
  /** Every statement and option, as Markdown. */
  syntax: string
  /** A complete source that renders without warnings. */
  example: string
}

/** One diagram type: how to spot it, parse it and draw it. */
export interface DiagramType<M = unknown> {
  id: string
  /** First words that select this type, e.g. ['mindmap', 'argue']. */
  keywords: string[]
  title: string
  /** One line on what it's for, shown in the gallery and in agent guidance. */
  summary: string
  guide?: Guide
  parse(source: string): Parsed<M>
  render(model: M, ctx: Context): Drawing | Promise<Drawing>
}

/** A diagram type with its model hidden behind a closure, so types of every model share a list. */
export interface Registered {
  id: string
  keywords: string[]
  title: string
  summary: string
  guide?: Guide
  run(body: string): {
    diagnostics: Diagnostic[]
    draw: ((ctx: Context) => Drawing | Promise<Drawing>) | null
  }
}

/** Wraps a diagram type for registration. Each family exports a list of these. */
export function define<M>(type: DiagramType<M>): Registered {
  return {
    id: type.id,
    keywords: type.keywords,
    title: type.title,
    summary: type.summary,
    guide: type.guide,
    run(body) {
      const { model, diagnostics } = type.parse(body)
      if (model === null) return { diagnostics, draw: null }
      const draw = (ctx: Context) => type.render(model, ctx)
      return { diagnostics, draw }
    },
  }
}

export interface RenderResult {
  svg: string
  width: number
  height: number
  /** The diagram type that drew it. */
  kind: string
  diagnostics: Diagnostic[]
}

export class DiagramError extends Error {
  diagnostics: Diagnostic[]
  constructor({ message, diagnostics }: { message: string; diagnostics: Diagnostic[] }) {
    super(message)
    this.name = 'DiagramError'
    this.diagnostics = diagnostics
  }
}
