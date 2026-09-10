import { describe, it, expect, vi, beforeEach } from 'vitest';

const getOidcConfigMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/oidc-provider', () => ({ getOidcConfig: getOidcConfigMock }));

import { GET } from './route';
import { DEFAULT_OIDC_BUTTON_LABEL } from '@/schemas/identity';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/client/v1/auth/methods', () => {
  it('reports oidc disabled when no provider is configured', async () => {
    getOidcConfigMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ oidc: { enabled: false, buttonLabel: null } });
  });

  it('reports oidc enabled with the configured button label', async () => {
    getOidcConfigMock.mockResolvedValue({
      issuer: 'https://idp.example.edu',
      clientId: 'afct',
      clientSecret: 'shh',
      buttonLabel: 'Sign in with PSU',
      trustEmail: false,
    });
    expect(await (await GET()).json()).toEqual({
      oidc: { enabled: true, buttonLabel: 'Sign in with PSU' },
    });
  });

  it('substitutes the default label when none is set, as the login page does', async () => {
    getOidcConfigMock.mockResolvedValue({
      issuer: 'https://idp.example.edu',
      clientId: 'afct',
      clientSecret: 'shh',
      buttonLabel: null,
      trustEmail: false,
    });
    expect(await (await GET()).json()).toEqual({
      oidc: { enabled: true, buttonLabel: DEFAULT_OIDC_BUTTON_LABEL },
    });
  });

  it('never leaks the issuer, client id or secret', async () => {
    getOidcConfigMock.mockResolvedValue({
      issuer: 'https://idp.example.edu',
      clientId: 'afct-client-id',
      clientSecret: 'super-secret',
      buttonLabel: 'Sign in',
      trustEmail: true,
    });
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toContain('idp.example.edu');
    expect(body).not.toContain('afct-client-id');
    expect(body).not.toContain('super-secret');
    expect(body).not.toContain('trustEmail');
  });
});
