import { define, type Registered } from '../../core/types.ts'
import { wireframe } from './wireframe.ts'

/** Low-fidelity UI screens. */
export const wireframeTypes: Registered[] = [define(wireframe)]
