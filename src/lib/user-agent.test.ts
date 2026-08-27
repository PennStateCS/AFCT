import { describe, expect, it } from 'vitest';
import { clientDescription } from './user-agent';

describe('naming the client an entry came from', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Chrome on Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Safari on macOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox on Linux'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari on iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    ['Java-http-client/17.0.10', 'Desktop client'],
  ])('reads %s as %s', (ua, expected) => {
    expect(clientDescription(ua)).toBe(expected);
  });

  /**
   * Edge and Opera both put Chrome in their string, and Chrome puts Safari in its. Matching in
   * the wrong order labels every Edge sign-in as Chrome, which is the kind of quiet wrongness
   * an audit trail cannot afford.
   */
  it('tells the browsers that impersonate each other apart', () => {
    expect(
      clientDescription(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      ),
    ).toBe('Edge on Windows');
    expect(
      clientDescription(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0',
      ),
    ).toBe('Opera on Windows');
  });

  it('gives whichever half it recognises', () => {
    expect(clientDescription('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
    expect(clientDescription('Chrome/128.0.0.0')).toBe('Chrome');
  });

  it('says nothing rather than guessing', () => {
    expect(clientDescription('AFCT-Health-Check/1.0')).toBeNull();
    // Matched case-sensitively, the way a real browser writes it, so a tool that happens to
    // mention its build triple is not reported as a person on a Linux desktop.
    expect(clientDescription('curl/8.5.0 (x86_64-pc-linux-gnu)')).toBeNull();
    expect(clientDescription('')).toBeNull();
    expect(clientDescription('   ')).toBeNull();
    expect(clientDescription(null)).toBeNull();
    expect(clientDescription(undefined)).toBeNull();
  });
});
