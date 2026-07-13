import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: toastMock }));

import { apiFetch, apiClient, mutateWithToast, ApiError } from './fetch-client';

const originalFetch = global.fetch;
const fetchMock = vi.fn();

/** Build a minimal Response-like object for the fetch mock. */
function res(init: {
  ok: boolean;
  status?: number;
  jsonBody?: unknown;
  textBody?: string;
  jsonThrows?: boolean;
}): Response {
  const status = init.status ?? (init.ok ? 200 : 400);
  return {
    ok: init.ok,
    status,
    json: async () => {
      if (init.jsonThrows) throw new Error('not json');
      return init.jsonBody;
    },
    text: async () => init.textBody ?? '',
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('apiFetch', () => {
  it('parses and returns the JSON body on success', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, textBody: JSON.stringify({ id: 'c1' }) }));
    await expect(apiFetch('/x')).resolves.toEqual({ id: 'c1' });
  });

  it('returns undefined for a 204 with no body', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, status: 204 }));
    await expect(apiFetch('/x')).resolves.toBeUndefined();
  });

  it('returns undefined for an empty 200 body', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, textBody: '' }));
    await expect(apiFetch('/x')).resolves.toBeUndefined();
  });

  it('throws ApiError carrying the server error message on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 409, jsonBody: { error: 'Nope' } }));
    await expect(apiFetch('/x')).rejects.toMatchObject({ message: 'Nope', status: 409 });
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('falls back to a status message when the error body has no error field', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500, jsonBody: {} }));
    await expect(apiFetch('/x')).rejects.toMatchObject({ message: 'Request failed (500)' });
  });

  it('falls back to a status message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 502, jsonThrows: true }));
    await expect(apiFetch('/x')).rejects.toMatchObject({ message: 'Request failed (502)' });
  });

  it('serializes a json body and sets the content-type header', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, textBody: '{}' }));
    await apiClient.post('/x', { a: 1 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('passes FormData through without forcing a content-type', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, textBody: '{}' }));
    const form = new FormData();
    form.append('file', 'x');
    await apiClient.postForm('/x', form);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).get('content-type')).toBeNull();
  });
});

describe('mutateWithToast', () => {
  it('toasts success and returns the data on success', async () => {
    const result = await mutateWithToast(async () => ({ id: 'c1' }), { success: 'Saved' });
    expect(result).toEqual({ ok: true, data: { id: 'c1' } });
    expect(toastMock.success).toHaveBeenCalledWith('Saved');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('does not toast success when no success message is given', async () => {
    await mutateWithToast(async () => 1);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('toasts the error message and returns ok:false on failure', async () => {
    const result = await mutateWithToast(async () => {
      throw new ApiError('Conflict', 409, null);
    });
    expect(result).toEqual({ ok: false, error: 'Conflict' });
    expect(toastMock.error).toHaveBeenCalledWith('Conflict');
  });

  it('uses the error fallback for a non-Error throw', async () => {
    const result = await mutateWithToast(
      async () => {
        throw { weird: true };
      },
      { error: 'Network error' },
    );
    expect(result).toEqual({ ok: false, error: 'Network error' });
    expect(toastMock.error).toHaveBeenCalledWith('Network error');
  });
});
