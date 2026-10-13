export function update(entry: {readonly id: number}, replace: boolean): number {
  if (replace) entry.id = 2;
  return entry.id;
}
