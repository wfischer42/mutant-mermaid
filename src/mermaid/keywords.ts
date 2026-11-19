/**
 * Mermaid 12.2's diagram types by the word their source starts with, and errors explained in terms
 * an author (or Claude) can fix the source from.
 */

/** The first-line keyword of every diagram type Mermaid 12.2 detects. */
export const MERMAID_KEYWORDS = [
  'graph',
  'flowchart',
  'flowchart-elk',
  'sequenceDiagram',
  'classDiagram',
  'classDiagram-v2',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantChart',
  'requirementDiagram',
  'gitGraph',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'mindmap',
  'timeline',
  'sankey',
  'sankey-beta',
  'xychart',
  'xychart-beta',
  'block',
  'block-beta',
  'packet',
  'packet-beta',
  'kanban',
  'architecture-beta',
  'radar-beta',
  'treemap',
  'treemap-beta',
  'venn-beta',
  'ishikawa',
  'ishikawa-beta',
  'treeView-beta',
  'wardley-beta',
  'cynefin-beta',
  'usecase-beta',
  'swimlane-beta',
  'agentflow-beta',
  'eventmodeling',
  'railroad-beta',
  'railroad-ebnf-beta',
  'railroad-abnf-beta',
  'railroad-peg-beta',
] as const

export type MermaidKeyword = (typeof MERMAID_KEYWORDS)[number]

const BY_LENGTH = [...MERMAID_KEYWORDS].sort((a, b) => b.length - a.length)

/** The source's first meaningful line: past frontmatter, `%%` comments and blank lines. */
export function firstLine(source: string): string {
  const body = source.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '')
  for (const line of body.split('\n')) {
    const text = line.trim()
    if (text && !text.startsWith('%%')) return text
  }
  return ''
}

/** The Mermaid keyword a source starts with, or null when it isn't a Mermaid diagram. */
export function mermaidKeyword(source: string): MermaidKeyword | null {
  const line = firstLine(source)
  const word = line.split(/[\s:;{]/)[0]
  return BY_LENGTH.find((k) => k === word || k.toLowerCase() === word.toLowerCase()) ?? null
}

/** Mermaid's error message rewritten to say what's wrong and where, with a hint toward the fix. */
export function explainMermaidError({
  source,
  message,
}: {
  source: string
  message: string
}): string {
  const keyword = mermaidKeyword(source)
  if (!keyword || /No diagram type detected/i.test(message)) {
    const line = firstLine(source)
    return `"${line.slice(0, 60)}" isn't a Mermaid diagram type. The first line must name one: ${MERMAID_KEYWORDS.join(', ')}.`
  }
  const text = message.replace(/^Error:\s*/, '').trim()
  const where = /line (\d+)/i.exec(text)
  const lines = source.split('\n')
  const quoted = where ? lines[Number(where[1]) - 1]?.trim() : undefined
  const at = quoted ? `\nLine ${where?.[1]}: ${quoted}` : ''
  return `Mermaid couldn't parse this ${keyword} diagram: ${text}${at}`
}
