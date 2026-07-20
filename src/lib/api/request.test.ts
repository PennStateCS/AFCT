import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  clampInt,
  parsePageParams,
  parseLimitOffset,
  formBool,
  formBoolOptional,
  readJson,
} from './request';

const params = (q: string) => new URLSearchParams(q);

const jsonReq = (body: string) =>
  new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

describe('clampInt', () => {
  it('clamps into range and truncates', () => {
    expect(clampInt(5.9, 1, 10, 3)).toBe(5);
    expect(clampInt(-2, 1, 10, 3)).toBe(1);
    expect(clampInt(99, 1, 10, 3)).toBe(10);
  });
  it('falls back on non-finite input', () => {
    expect(clampInt(NaN, 1, 10, 3)).toBe(3);
    expect(clampInt(Infinity, 1, 10, 3)).toBe(3);
  });
});

describe('parsePageParams', () => {
  const opts = { defaultSize: 50, maxSize: 200 };
  it('defaults when params are absent', () => {
    expect(parsePageParams(params(''), opts)).toEqual({
      page: 1,
      pageSize: 50,
      skip: 0,
      take: 50,
    });
  });
  it('clamps pageSize and computes skip/take', () => {
    expect(parsePageParams(params('page=3&pageSize=999'), opts)).toEqual({
      page: 3,
      pageSize: 200,
      skip: 400,
      take: 200,
    });
  });
  it('treats a non-numeric page as the default (not the Number(null)=0 trap)', () => {
    expect(parsePageParams(params('page=abc'), opts).page).toBe(1);
  });
});

describe('parseLimitOffset', () => {
  const opts = { defaultLimit: 50, maxLimit: 100 };
  it('defaults when absent', () => {
    expect(parseLimitOffset(params(''), opts)).toEqual({ limit: 50, offset: 0 });
  });
  it('clamps limit and floors offset at 0', () => {
    expect(parseLimitOffset(params('limit=500&offset=20'), opts)).toEqual({
      limit: 100,
      offset: 20,
    });
    expect(parseLimitOffset(params('offset=-5'), opts).offset).toBe(0);
  });
  it('falls back on a non-numeric limit instead of yielding NaN', () => {
    expect(parseLimitOffset(params('limit=xyz'), opts).limit).toBe(50);
  });
});

describe('formBool / formBoolOptional', () => {
  const form = () => {
    const f = new FormData();
    f.set('yes', 'true');
    f.set('no', 'false');
    return f;
  };
  it('formBool maps "true" → true, else false', () => {
    expect(formBool(form(), 'yes')).toBe(true);
    expect(formBool(form(), 'no')).toBe(false);
    expect(formBool(form(), 'missing')).toBe(false);
  });
  it('formBoolOptional is undefined when the field is absent', () => {
    expect(formBoolOptional(form(), 'yes')).toBe(true);
    expect(formBoolOptional(form(), 'no')).toBe(false);
    expect(formBoolOptional(form(), 'missing')).toBeUndefined();
  });
});

describe('readJson', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('returns typed data for a valid body', async () => {
    const parsed = await readJson(jsonReq('{"name":"a","age":3}'), schema);
    expect(parsed).toEqual({ ok: true, data: { name: 'a', age: 3 } });
  });

  it('returns a 400 response for malformed JSON', async () => {
    const parsed = await readJson(jsonReq('{not json'), schema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      await expect(parsed.response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    }
  });

  it('returns a 400 response with field detail on schema mismatch', async () => {
    const parsed = await readJson(jsonReq('{"name":"a"}'), schema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      const body = (await parsed.response.json()) as { error: string };
      expect(body.error).toContain('age');
    }
  });
});

describe('readJson body size limit', () => {
  const Schema = z.object({ a: z.string() });

  it('accepts a normal small body', async () => {
    const res = await readJson(jsonReq(JSON.stringify({ a: 'ok' })), Schema);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.a).toBe('ok');
  });

  it('rejects an oversized body with 413 rather than parsing it', async () => {
    // Well past the 64 KB default for a JSON route.
    const huge = JSON.stringify({ a: 'x'.repeat(200_000) });
    const res = await readJson(jsonReq(huge), Schema);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(413);
  });

  it('rejects on a declared Content-Length over the cap, before reading the body', async () => {
    // Content-Length is attacker-controlled, so this is only the cheap first gate; the
    // streaming check below is what actually bounds memory.
    const req = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '10000000' },
      body: JSON.stringify({ a: 'small' }),
    });
    const res = await readJson(req, Schema);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(413);
  });

  it('honours a per-route override', async () => {
    const res = await readJson(jsonReq(JSON.stringify({ a: 'abcdefghij' })), Schema, {
      maxBytes: 8,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(413);
  });

  it('still reports malformed JSON as 400', async () => {
    const res = await readJson(jsonReq('{ not json'), Schema);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(400);
  });
});
