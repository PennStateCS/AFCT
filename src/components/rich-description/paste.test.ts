/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { sanitizePastedHTML } from './paste';

describe('sanitizePastedHTML', () => {
  it('keeps supported semantic structure', () => {
    const out = sanitizePastedHTML(
      '<h2>Heading</h2><p>Some <strong>bold</strong> and <em>italic</em> text.</p>' +
        '<ul><li>one</li><li>two</li></ul><blockquote>quoted</blockquote><code>x</code>',
    );
    expect(out).toContain('<h2>');
    expect(out).toContain('<strong>');
    expect(out).toContain('<em>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<code>');
  });

  it('strips pasted fonts, sizes, and colours', () => {
    const out = sanitizePastedHTML(
      '<p style="color: #ff0000; font-family: Comic Sans MS; font-size: 32pt">loud</p>',
    );
    expect(out).not.toMatch(/color/i);
    expect(out).not.toMatch(/comic sans/i);
    expect(out).not.toMatch(/font-size/i);
    expect(out).toContain('loud');
  });

  it('keeps the inline styles the editor actually parses', () => {
    const out = sanitizePastedHTML(
      '<p style="text-align: center; color: red">centred</p><span style="font-weight: bold">b</span>',
    );
    expect(out).toContain('text-align: center');
    expect(out).toContain('font-weight: bold');
    expect(out).not.toMatch(/color\s*:\s*red/i);
  });

  it('drops class, id, and presentational attributes', () => {
    const out = sanitizePastedHTML(
      '<p class="MsoNormal" id="x" align="center" bgcolor="#eee" width="500">text</p>',
    );
    expect(out).not.toContain('MsoNormal');
    expect(out).not.toContain('id=');
    expect(out).not.toContain('align=');
    expect(out).not.toContain('bgcolor');
    expect(out).not.toContain('width');
  });

  it('removes elements that must never contribute content', () => {
    const out = sanitizePastedHTML(
      '<p>before</p><script>alert(1)</script><style>p{color:red}</style>' +
        '<img src="x.png"><iframe src="https://example.com"></iframe><svg><circle /></svg>' +
        '<table><tr><td>cell</td></tr></table><p>after</p>',
    );
    expect(out).not.toMatch(/script|iframe|<svg|alert\(1\)/i);
    // The <style> element's CSS text must not leak in as prose.
    expect(out).not.toContain('color:red');
    expect(out).toContain('before');
    expect(out).toContain('after');
    // A table is dropped by the schema later; its text is not silently discarded here.
    expect(out).toContain('cell');
  });

  it('strips event handlers', () => {
    const out = sanitizePastedHTML('<p onclick="steal()" onmouseover="x()">text</p>');
    expect(out).not.toMatch(/onclick|onmouseover|steal/i);
  });

  it('unwraps the Google Docs font-weight:normal bold wrapper', () => {
    const out = sanitizePastedHTML(
      '<b style="font-weight:normal" id="docs-internal-guid-1"><p>not actually bold</p></b>',
    );
    expect(out).not.toContain('<b');
    expect(out).toContain('not actually bold');
  });

  it('keeps a genuine bold wrapper', () => {
    const out = sanitizePastedHTML('<b>really bold</b>');
    expect(out).toContain('<b>');
  });

  it('removes Word comments and namespaced tags but keeps their text', () => {
    const out = sanitizePastedHTML(
      '<!--[if gte mso 9]><xml>junk</xml><![endif]--><p>kept<o:p>tail</o:p></p>',
    );
    expect(out).not.toContain('mso');
    expect(out).not.toContain('<o:p>');
    expect(out).toContain('kept');
    expect(out).toContain('tail');
  });

  it('keeps only the data attributes the editor parses, so equations survive a copy', () => {
    const out = sanitizePastedHTML(
      '<span data-type="inline-math" data-latex="n^2" data-tracking="spy">x</span>' +
        '<p data-align="center" data-mce-style="junk">c</p>',
    );
    expect(out).toContain('data-type="inline-math"');
    expect(out).toContain('data-latex="n^2"');
    expect(out).toContain('data-align="center"');
    expect(out).not.toContain('data-tracking');
    expect(out).not.toContain('data-mce-style');
  });

  it('leaves an empty payload alone', () => {
    expect(sanitizePastedHTML('')).toBe('');
  });
});
