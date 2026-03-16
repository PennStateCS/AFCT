export function truncate(text: string, maxLength = 25): string {
  const safeLength = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : 25;

  if (text.length <= safeLength) {
    return text;
  }

  return `${text.slice(0, safeLength)}...`;
}