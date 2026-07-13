import { describe, it, expect } from 'vitest';
import { errMessage } from './errors';

describe('errMessage', () => {
  it('returns the message of an Error', () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a non-empty thrown string as-is', () => {
    expect(errMessage('plain failure')).toBe('plain failure');
  });

  it('falls back for non-Error, non-string values', () => {
    expect(errMessage(null)).toBe('Something went wrong');
    expect(errMessage(undefined)).toBe('Something went wrong');
    expect(errMessage({ code: 500 })).toBe('Something went wrong');
    expect(errMessage(42)).toBe('Something went wrong');
  });

  it('falls back for an empty/whitespace string', () => {
    expect(errMessage('   ')).toBe('Something went wrong');
  });

  it('uses the provided fallback', () => {
    expect(errMessage(null, 'Network error')).toBe('Network error');
    expect(errMessage({}, 'Network error')).toBe('Network error');
  });

  it('subclasses of Error still resolve to their message', () => {
    class ApiError extends Error {}
    expect(errMessage(new ApiError('not found'))).toBe('not found');
  });
});
