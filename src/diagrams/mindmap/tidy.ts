/**
 * A compact tidy-tree layout for trees whose nodes already know where they sit along the main
 * axis (x for left-to-right trees, y for top-down ones). It only decides the cross axis: each
 * subtree is pushed just far enough from its earlier siblings that no two boxes whose main-axis
 * spans overlap come closer than the gap, and each parent is centred on its first and last child.
 *
 * Unlike stacking whole subtree extents, a shallow subtree can tuck in beside a deep one.
 */
export interface Tidy<T> {
  /** Start of the node along the main axis. */
  lo: number
  /** End of the node along the main axis. */
  hi: number
  /** Size of the node along the cross axis. */
  size: number
  children: T[]
  /** Set by `tidy`: the node's cross-axis centre relative to its parent's. */
  offset: number
  /** Set by `tidy`: the node's cross-axis centre, the root sitting at 0. */
  center: number
}

interface Box {
  lo: number
  hi: number
  c0: number
  c1: number
}

function overlaps({ a, b }: { a: Box; b: Box }): boolean {
  return a.lo < b.hi && b.lo < a.hi
}

function shifted({ boxes, by }: { boxes: Box[]; by: number }): Box[] {
  return boxes.map((b) => ({ ...b, c0: b.c0 + by, c1: b.c1 + by }))
}

/** How far `next` must move along the cross axis to clear `placed` by `gap`. */
function clearance({ placed, next, gap }: { placed: Box[]; next: Box[]; gap: number }): number {
  let shift = Number.NEGATIVE_INFINITY
  for (const a of placed)
    for (const b of next) if (overlaps({ a, b })) shift = Math.max(shift, a.c1 + gap - b.c0)
  return shift
}

function arrange<T extends Tidy<T>>({
  node,
  depth,
  gap,
}: {
  node: T
  depth: number
  gap: (depth: number) => number
}): Box[] {
  const placed: Box[] = []
  const offsets: number[] = []
  for (const child of node.children) {
    const boxes = arrange({ node: child, depth: depth + 1, gap })
    const needed = placed.length ? clearance({ placed, next: boxes, gap: gap(depth) }) : 0
    const offset = Number.isFinite(needed) ? needed : (offsets[offsets.length - 1] ?? 0)
    offsets.push(offset)
    placed.push(...shifted({ boxes, by: offset }))
  }
  const mid = offsets.length ? (offsets[0] + offsets[offsets.length - 1]) / 2 : 0
  node.children.forEach((child, i) => {
    child.offset = offsets[i] - mid
  })
  const own: Box = { lo: node.lo, hi: node.hi, c0: -node.size / 2, c1: node.size / 2 }
  return [own, ...shifted({ boxes: placed, by: -mid })]
}

function settle<T extends Tidy<T>>({ node, center }: { node: T; center: number }): void {
  node.center = center
  for (const child of node.children) settle({ node: child, center: center + child.offset })
}

/**
 * Lays the tree out along the cross axis, filling in `offset` and `center` on every node.
 * `gap(depth)` is the clearance between the subtrees of children of a node at that depth.
 */
export function tidy<T extends Tidy<T>>({
  root,
  gap,
}: {
  root: T
  gap: (depth: number) => number
}): void {
  arrange({ node: root, depth: 0, gap })
  settle({ node: root, center: 0 })
}

/** Every node in the tree, parents before children. */
export function walk<T extends { children: T[] }>(root: T): T[] {
  return [root, ...root.children.flatMap((child) => walk(child))]
}
