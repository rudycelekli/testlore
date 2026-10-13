export function label(value: string | null): string {
  if (value === null) return value;
  return value.toUpperCase();
}
