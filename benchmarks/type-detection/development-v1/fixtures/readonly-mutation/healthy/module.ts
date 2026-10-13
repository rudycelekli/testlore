export function update(entry: {readonly id: number}, replace: boolean): number {
  if (replace) return 2;
  return entry.id;
}
