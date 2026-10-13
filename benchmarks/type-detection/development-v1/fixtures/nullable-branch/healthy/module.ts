export function label(value: string | null): string {
  if (value === null) return 'missing';
  return value.toUpperCase();
}
