export function parseBool(v: unknown): boolean | undefined {
  if (v == null) return undefined;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return undefined;
}

export function parseList(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.map(String);
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
