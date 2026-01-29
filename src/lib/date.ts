// src/lib/date.ts
export function toISODate(d: Date) {
  // "YYYY-MM-DD"
  return d.toISOString().slice(0, 10);
}

export function fromInputDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  // Avoid TZ surprises
  return new Date(`${s}T00:00:00`);
}

export function toInputDate(d?: Date): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
