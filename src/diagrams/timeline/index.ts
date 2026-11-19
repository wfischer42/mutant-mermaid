import { define, type Registered } from '../../core/types.ts'
import { timeline } from './timeline.ts'

/** Timelines across many time scales. */
export const timelineTypes: Registered[] = [define(timeline)]
