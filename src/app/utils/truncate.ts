// Cut off string at 50 chars
export function truncate(s: string, n: number): string {
    if (s.length > n) {
        s = s.slice(0, n-3);
        s += "...";
    }
    return s;
}