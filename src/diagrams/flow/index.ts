import { define, type Registered } from '../../core/types.ts'
import { flowchart } from './flowchart.ts'
import { stateDiagram } from './state.ts'

/** Graph diagrams in Mermaid's own syntax, drawn by our renderer: flowcharts and state diagrams. */
export const flowTypes: Registered[] = [define(flowchart), define(stateDiagram)]
