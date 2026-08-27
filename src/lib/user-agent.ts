/**
 * A user-agent string as the two facts anybody reads it for: which browser, on what.
 *
 * The log stores the whole header and the detail view shows it, but a 140-character string is
 * not something a table row can carry. "Chrome on Windows" next to the address is enough to
 * tell a sign-in from the lab apart from one from somebody's phone, which is the question
 * being asked when an entry looks wrong.
 *
 * Deliberately shallow. There is no parser dependency here and there should not be one: this
 * is a label on an audit row, and being unable to name a browser is a fine outcome. Anything
 * unrecognised returns null so the row shows the address alone rather than a guess.
 */

/** Order matters: Edge and Opera both claim to be Chrome, and Chrome claims to be Safari. */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  [/\bWindows NT\b/, 'Windows'],
  [/\biPhone\b|\biPad\b|\biPod\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

export function clientDescription(userAgent?: string | null): string | null {
  const ua = userAgent?.trim();
  if (!ua) return null;

  // The native student client sets no User-Agent of its own, so what arrives is whatever its
  // HTTP stack sends. Nothing else in the product calls the API from Java, so this is the
  // desktop client. If that ever stops being true, the honest fix is to have the client
  // identify itself rather than to widen the guess here.
  if (/^Java-http-client\//i.test(ua) || /^Java\//i.test(ua)) return 'Desktop client';

  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  const platform = PLATFORMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform;
}
