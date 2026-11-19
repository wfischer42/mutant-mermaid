import { diagramTypes } from './render.ts'
import type { Registered } from './types.ts'

/** What every source shares, so each type's syntax can leave it out. */
const COMMON = `Every source:
- The first line is the header, starting with the keyword; the syntax above shows what else it
  takes. Content goes on the lines under it.
- \`%%\` starts a comment.
- A \`---\` frontmatter block at the top can set \`theme\`, \`dark\`, \`look\` and \`seed\`.
- Errors give the line number and the fix. Warnings don't stop the drawing; they come back in the
  result's \`diagnostics\`, and you should fix them too.`

function findType(keyword: string): Registered | undefined {
  const word = keyword.toLowerCase()
  return diagramTypes().find((type) => type.keywords.some((k) => k.toLowerCase() === word))
}

function catalogLine(type: Registered): string {
  const keywords = type.keywords.map((k) => `\`${k}\``).join(' ')
  const when = type.guide ? ` Use when: ${type.guide.useWhen}` : ''
  return `- ${keywords}: ${type.summary}${when}`
}

function catalog(): string {
  return [
    '# Diagram types',
    '',
    "The source's first word picks the type.",
    '',
    ...diagramTypes().map(catalogLine),
    '- Any other Mermaid keyword (`sequenceDiagram`, `erDiagram`, `gantt`, `pie`…) renders with Mermaid, themed to match.',
    '',
    'Call `guide(keyword)` for a type’s full syntax and an example.',
  ].join('\n')
}

function reference(type: Registered): string {
  const keywords = type.keywords.map((k) => `\`${k}\``).join(', ')
  if (!type.guide)
    return `# ${type.title} (${keywords})\n\n${type.summary}\n\nNo syntax reference has been written for this type yet.`
  const { useWhen, syntax, example } = type.guide
  return [
    `# ${type.title} (${keywords})`,
    '',
    `${type.summary} Use when: ${useWhen}`,
    '',
    '## Syntax',
    '',
    syntax.trim(),
    '',
    '## Example',
    '',
    '```',
    example.trim(),
    '```',
    '',
    COMMON,
  ].join('\n')
}

/**
 * Agent guidance as Markdown: with no keyword, a short catalog of every type to keep in context;
 * with one, that type's full syntax and an example. Returns null for a keyword no type claims.
 */
export function guide(keyword?: string): string | null {
  if (keyword === undefined) return catalog()
  const type = findType(keyword)
  return type ? reference(type) : null
}
