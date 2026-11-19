import { define, type Registered } from '../../core/types.ts'
import { causalLoop, stockFlow } from './systems.ts'

/** Systems diagrams: causal loops and stock & flow. */
export const systemsTypes: Registered[] = [define(causalLoop), define(stockFlow)]
