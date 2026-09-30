import { format } from './shared.js';
export function totalLabel(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new RangeError('Expected nonnegative integer cents');
  return format(`$${(cents / 100).toFixed(2)}`);
}
