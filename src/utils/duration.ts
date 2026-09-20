const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!trimmed) return null;
  const pattern = /(\d+)(w|d|h|m|s)/g;
  let match: RegExpExecArray | null;
  let totalMs = 0;
  let matchedLength = 0;
  while ((match = pattern.exec(trimmed)) !== null) {
    const [full, amountStr, unit] = match;
    totalMs += parseInt(amountStr, 10) * UNIT_MS[unit];
    matchedLength += full.length;
  }
  if (matchedLength !== trimmed.length || totalMs <= 0) return null;
  return totalMs;
}
export function formatDuration(ms: number): string {
  const units: [string, number][] = [
    ["w", UNIT_MS.w],
    ["d", UNIT_MS.d],
    ["h", UNIT_MS.h],
    ["m", UNIT_MS.m],
    ["s", UNIT_MS.s],
  ];
  let remaining = ms;
  const parts: string[] = [];
  for (const [label, unitMs] of units) {
    const value = Math.floor(remaining / unitMs);
    if (value > 0) {
      parts.push(`${value}${label}`);
      remaining -= value * unitMs;
    }
  }
  return parts.length ? parts.join(" ") : "0s";
}
export function parseDurationOrPermanent(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "0") return 0;
  return parseDuration(trimmed);
}