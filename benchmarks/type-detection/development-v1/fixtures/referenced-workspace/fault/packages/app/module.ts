import type {Result} from '../contracts/types.js';
export function next(mode: 'idle' | 'fast'): Result {
  if (mode === 'idle') return {value: 0};
  return {value: '1'};
}
