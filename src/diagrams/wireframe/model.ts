/**
 * The wireframe model: a screen inside a device frame, holding a tree of elements. Containers
 * (rows, columns, cards, headers…) lay out their children; widgets (buttons, inputs, images…) draw
 * themselves at the size the layout gives them.
 */

export const CONTAINERS = [
  'col',
  'row',
  'header',
  'footer',
  'sidebar',
  'main',
  'section',
  'card',
  'grid',
  'modal',
] as const

export const WIDGETS = [
  'h1',
  'h2',
  'h3',
  'text',
  'lines',
  'link',
  'button',
  'input',
  'textarea',
  'select',
  'search',
  'check',
  'radio',
  'toggle',
  'image',
  'avatar',
  'icon',
  'logo',
  'badge',
  'nav',
  'tabs',
  'list',
  'table',
  'chart',
  'divider',
  'spacer',
] as const

export type ContainerKind = (typeof CONTAINERS)[number]
export type WidgetKind = (typeof WIDGETS)[number]
export type Kind = ContainerKind | WidgetKind

/** One `|`-separated piece of a nav, tab strip, list row or table row; `[x]` marks it. */
export interface Part {
  text: string
  marked: boolean
}

export interface Element {
  kind: Kind
  label: string
  /** Text after ` : `: an input's placeholder, a list row's trailing value. */
  note?: string
  /** The label split at ` | `, for navs, tab strips and table rows. */
  parts: Part[]
  attrs: Record<string, string>
  flags: Set<string>
  color?: string
  /** Rows of a list or table: each one split into parts. */
  rows: Part[][]
  children: Element[]
  line: number
}

export type Device = 'phone' | 'tablet' | 'browser' | 'none'

export interface WireframeModel {
  title: string
  device: Device
  /** Screen width in pixels, from the device unless given. */
  width: number
  /** Shown in the browser's address bar. */
  url: string
  elements: Element[]
}

export function isContainer(kind: Kind): kind is ContainerKind {
  return CONTAINERS.some((c) => c === kind)
}
