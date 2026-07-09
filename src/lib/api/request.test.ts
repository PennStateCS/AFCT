import { describe, expect, it } from 'vitest';
import { clampInt, parsePageParams, parseLimitOffset, formBool, formBoolOptional } from './request';

const params = (q: string) => new URLSearchParams(q);

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
