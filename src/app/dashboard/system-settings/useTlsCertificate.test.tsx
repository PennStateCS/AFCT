/** @vitest-environment jsdom */
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const showToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast }));

import { useTlsCertificate, type TlsInfo } from './useTlsCertificate';

/**
 * The TLS subsystem of System Settings.
 *
 * This is the screen a professor uses to put a real certificate on their own install, and
 * getting it wrong takes the site off the air, so the behaviour worth pinning is mostly about
 * refusing to act on incomplete input and reporting failure honestly. Three rules run through
 * every flow here: a guard that fails must not call the server, a server error must surface the
 * server's own message rather than a generic one, and `tlsBusy` must always come back down so
 * the form is never left permanently disabled.
 */

const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
};

const fetchMock = vi.fn();

const INSTALLED: TlsInfo = {
  installed: true,
  subject: 'CN=afct.example.edu',
  issuer: "CN=Let's Encrypt",
  selfSigned: false,
};

/** A File whose .text() resolves, which jsdom's File does not implement on its own. */
const fileOf = (name: string, body: string) => {
  const f = new File([body], name);
  Object.defineProperty(f, 'text', { value: () => Promise.resolve(body) });
  return f;
};

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const fail = (body: unknown, status = 400) => ({ ok: false, status, json: async () => body });

/** Mount with the initial status read already answered, so tests start from a known state. */
async function mount(initial: TlsInfo = { installed: false }) {
  fetchMock.mockResolvedValueOnce(ok(initial));
  const view = renderHook(() => useTlsCertificate(), { wrapper: createWrapper() });
  await waitFor(() => expect(view.result.current.tls).toEqual(initial));
  fetchMock.mockReset();
  return view;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:stub'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchMock.mockReset();
  showToast.success.mockReset();
  showToast.error.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useTlsCertificate: status read', () => {
  it('starts with no certificate info and fills it from the server', async () => {
    const { result } = await mount(INSTALLED);
    expect(result.current.tls).toEqual(INSTALLED);
    expect(result.current.tlsBusy).toBe(false);
  });

  it('leaves tls null when the status read fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useTlsCertificate(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.tls).toBeNull());
  });

  it('reports a missing common name so the CSR buttons can disable themselves', async () => {
    const { result } = await mount();
    expect(result.current.cnMissing).toBe(true);

    act(() => result.current.setCsrCommonName('   '));
    expect(result.current.cnMissing).toBe(true);

    act(() => result.current.setCsrCommonName('afct.example.edu'));
    expect(result.current.cnMissing).toBe(false);
  });
});

describe('useTlsCertificate: uploading a certificate', () => {
  it('refuses to upload without both a certificate and a key', async () => {
    const { result } = await mount();

    await act(async () => result.current.applyCert());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(showToast.error).toHaveBeenCalledWith('Select both a certificate and a private key.');

    act(() => result.current.setCertFile(fileOf('cert.pem', 'CERT')));
    await act(async () => result.current.applyCert());
    // Still refused: the key is the half that is missing.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends cert, key and chain, then clears the form', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setCertFile(fileOf('cert.pem', 'CERT'));
      result.current.setKeyFile(fileOf('key.pem', 'KEY'));
      result.current.setChainFile(fileOf('chain.pem', 'CHAIN'));
      result.current.setTlsMethod('upload');
    });
    fetchMock.mockResolvedValueOnce(ok(INSTALLED));

    await act(async () => result.current.applyCert());

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ cert: 'CERT', key: 'KEY', chain: 'CHAIN' });
    expect(result.current.tls).toEqual(INSTALLED);
    expect(result.current.certFile).toBeNull();
    expect(result.current.keyFile).toBeNull();
    expect(result.current.chainFile).toBeNull();
    expect(result.current.tlsMethod).toBeNull();
    expect(showToast.success).toHaveBeenCalled();
  });

  it('omits the chain when none was chosen', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setCertFile(fileOf('cert.pem', 'CERT'));
      result.current.setKeyFile(fileOf('key.pem', 'KEY'));
    });
    fetchMock.mockResolvedValueOnce(ok(INSTALLED));

    await act(async () => result.current.applyCert());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).chain).toBeUndefined();
  });

  it("surfaces the server's own reason and keeps the files for another try", async () => {
    const { result } = await mount();
    act(() => {
      result.current.setCertFile(fileOf('cert.pem', 'CERT'));
      result.current.setKeyFile(fileOf('key.pem', 'KEY'));
    });
    fetchMock.mockResolvedValueOnce(fail({ error: 'The key does not match the certificate.' }));

    await act(async () => result.current.applyCert());

    expect(showToast.error).toHaveBeenCalledWith('The key does not match the certificate.');
    // Not cleared: making the operator re-pick both files to retry would be hostile.
    expect(result.current.certFile).not.toBeNull();
    expect(result.current.tlsBusy).toBe(false);
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setCertFile(fileOf('cert.pem', 'CERT'));
      result.current.setKeyFile(fileOf('key.pem', 'KEY'));
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    });

    await act(async () => result.current.applyCert());
    expect(showToast.error).toHaveBeenCalledWith('Failed to apply certificate.');
  });
});

describe('useTlsCertificate: reverting to self-signed', () => {
  it('deletes and adopts the returned info', async () => {
    const { result } = await mount(INSTALLED);
    fetchMock.mockResolvedValueOnce(ok({ installed: true, selfSigned: true }));

    await act(async () => result.current.resetCert());

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
    expect(result.current.tls).toEqual({ installed: true, selfSigned: true });
    expect(showToast.success).toHaveBeenCalledWith('Reverted to the self-signed certificate.');
  });

  it('reports a failed reset and clears busy', async () => {
    const { result } = await mount(INSTALLED);
    fetchMock.mockResolvedValueOnce(fail({ error: 'nginx would not reload' }));

    await act(async () => result.current.resetCert());

    expect(showToast.error).toHaveBeenCalledWith('nginx would not reload');
    expect(result.current.tlsBusy).toBe(false);
  });
});

describe('useTlsCertificate: CSR flow', () => {
  it('refuses without a common name', async () => {
    const { result } = await mount();
    await act(async () => result.current.generateCsr());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(showToast.error).toHaveBeenCalledWith('Enter a hostname (Common Name) first.');
  });

  it('trims the fields and splits alt names into a list', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setCsrCommonName('  afct.example.edu  ');
      result.current.setCsrOrganization('  Penn State  ');
      result.current.setCsrAltNames(' a.example.edu , ,b.example.edu ');
    });
    fetchMock.mockResolvedValueOnce(ok({ installed: false, pendingCsr: true, csr: '---CSR---' }));

    await act(async () => result.current.generateCsr());

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'generate-csr',
      commonName: 'afct.example.edu',
      organization: 'Penn State',
      altNames: ['a.example.edu', 'b.example.edu'],
    });
  });

  it('omits an empty organization rather than sending a blank one', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setCsrCommonName('afct.example.edu');
      result.current.setCsrOrganization('   ');
    });
    fetchMock.mockResolvedValueOnce(ok({ installed: false }));

    await act(async () => result.current.generateCsr());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).organization).toBeUndefined();
  });

  it('downloads the CSR the server returns', async () => {
    const { result } = await mount();
    act(() => result.current.setCsrCommonName('afct.example.edu'));
    fetchMock.mockResolvedValueOnce(ok({ installed: false, pendingCsr: true, csr: '---CSR---' }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => result.current.generateCsr());

    expect(click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    // The object URL is released rather than leaked for the life of the page.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stub');
  });

  it('does not attempt a download when the server returned no CSR', async () => {
    const { result } = await mount();
    act(() => result.current.setCsrCommonName('afct.example.edu'));
    fetchMock.mockResolvedValueOnce(ok({ installed: false }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => result.current.generateCsr());
    expect(click).not.toHaveBeenCalled();
  });

  it('refuses to install a signed certificate without the certificate itself', async () => {
    const { result } = await mount();
    await act(async () => result.current.installSignedCert());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(showToast.error).toHaveBeenCalledWith('Choose the certificate returned by your CA.');
  });

  it('installs the signed certificate and clears the flow', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setSignedCertFile(fileOf('signed.pem', 'SIGNED'));
      result.current.setSignedChainFile(fileOf('chain.pem', 'CHAIN'));
      result.current.setTlsMethod('csr');
    });
    fetchMock.mockResolvedValueOnce(ok(INSTALLED));

    await act(async () => result.current.installSignedCert());

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'install-signed',
      cert: 'SIGNED',
      chain: 'CHAIN',
    });
    expect(result.current.signedCertFile).toBeNull();
    expect(result.current.signedChainFile).toBeNull();
    expect(result.current.tlsMethod).toBeNull();
  });
});

describe('useTlsCertificate: self-signed', () => {
  it('refuses without a common name', async () => {
    const { result } = await mount();
    await act(async () => result.current.generateSelfSigned());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(showToast.error).toHaveBeenCalledWith('Enter a hostname (Common Name) first.');
  });

  it('generates for the given hostname and closes the method picker', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setCsrCommonName('afct.local');
      result.current.setTlsMethod('self-signed');
    });
    fetchMock.mockResolvedValueOnce(ok({ installed: true, selfSigned: true }));

    await act(async () => result.current.generateSelfSigned());

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      action: 'self-signed',
      commonName: 'afct.local',
    });
    expect(result.current.tlsMethod).toBeNull();
  });
});

describe("useTlsCertificate: Let's Encrypt", () => {
  it('refuses without a domain and an email', async () => {
    const { result } = await mount();

    await act(async () => result.current.requestLetsEncrypt());
    expect(showToast.error).toHaveBeenCalledWith('Enter the domain and a contact email.');

    act(() => result.current.setLeDomain('afct.example.edu'));
    await act(async () => result.current.requestLetsEncrypt());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses until the terms of service are accepted', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setLeDomain('afct.example.edu');
      result.current.setLeEmail('admin@example.edu');
    });

    await act(async () => result.current.requestLetsEncrypt());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(showToast.error).toHaveBeenCalledWith(
      'You must agree to the Let’s Encrypt terms of service.',
    );
  });

  it('issues, passes the staging flag, and clears progress afterwards', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setLeDomain(' afct.example.edu ');
      result.current.setLeEmail(' admin@example.edu ');
      result.current.setLeStaging(true);
      result.current.setLeTos(true);
    });
    fetchMock.mockResolvedValueOnce(ok(INSTALLED));

    await act(async () => result.current.requestLetsEncrypt());

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'lets-encrypt',
      domain: 'afct.example.edu',
      email: 'admin@example.edu',
      staging: true,
    });
    expect(result.current.tls).toEqual(INSTALLED);
    // The progress box must not be left on screen after the request settles.
    expect(result.current.leProgress).toBeNull();
    expect(result.current.tlsBusy).toBe(false);
  });

  it('clears progress and busy when issuance fails', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setLeDomain('afct.example.edu');
      result.current.setLeEmail('admin@example.edu');
      result.current.setLeTos(true);
    });
    fetchMock.mockResolvedValueOnce(fail({ error: 'DNS challenge failed' }));

    await act(async () => result.current.requestLetsEncrypt());

    expect(showToast.error).toHaveBeenCalledWith('DNS challenge failed');
    expect(result.current.leProgress).toBeNull();
    expect(result.current.tlsBusy).toBe(false);
  });

  it('stops polling for progress once the request settles', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(ok({ installed: false }));
      const { result } = renderHook(() => useTlsCertificate(), { wrapper: createWrapper() });
      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        result.current.setLeDomain('afct.example.edu');
        result.current.setLeEmail('admin@example.edu');
        result.current.setLeTos(true);
      });
      fetchMock.mockResolvedValue(ok(INSTALLED));

      await act(async () => result.current.requestLetsEncrypt());
      const callsAfterIssue = fetchMock.mock.calls.length;

      // A leaked interval would keep hitting the progress endpoint forever.
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(fetchMock.mock.calls.length).toBe(callsAfterIssue);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The progress poller.
   *
   * Issuance blocks for as long as the CA takes, so without this the dialog is a bare spinner
   * on the one screen where an operator most needs to know whether anything is happening. The
   * poll runs alongside the blocking request, which is why these tests hold the request open
   * with a deferred promise and drive the clock underneath it.
   */
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  async function startIssuance() {
    fetchMock.mockResolvedValueOnce(ok({ installed: false }));
    const { result } = renderHook(() => useTlsCertificate(), { wrapper: createWrapper() });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.setLeDomain('afct.example.edu');
      result.current.setLeEmail('admin@example.edu');
      result.current.setLeTos(true);
    });
    return result;
  }

  it('shows a starting phase immediately, before the first poll', async () => {
    vi.useFakeTimers();
    try {
      const result = await startIssuance();
      const issue = deferred<unknown>();
      fetchMock.mockReturnValueOnce(issue.promise);

      let pending!: Promise<void>;
      act(() => {
        pending = result.current.requestLetsEncrypt();
      });
      expect(result.current.leProgress).toEqual({ phase: 'starting' });

      issue.resolve(ok(INSTALLED));
      await act(async () => {
        await pending;
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces the phase with what the server reports', async () => {
    vi.useFakeTimers();
    try {
      const result = await startIssuance();
      const issue = deferred<unknown>();
      fetchMock.mockReturnValueOnce(issue.promise);
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.requestLetsEncrypt();
      });

      fetchMock.mockResolvedValue(ok({ phase: 'challenge', message: 'answering http-01' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(result.current.leProgress).toEqual({
        phase: 'challenge',
        message: 'answering http-01',
      });

      issue.resolve(ok(INSTALLED));
      await act(async () => {
        await pending;
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an idle phase, a failed poll, and a poll that throws', async () => {
    vi.useFakeTimers();
    try {
      const result = await startIssuance();
      const issue = deferred<unknown>();
      fetchMock.mockReturnValueOnce(issue.promise);
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.requestLetsEncrypt();
      });

      // 'idle' means the server has not written a real phase yet.
      fetchMock.mockResolvedValueOnce(ok({ phase: 'idle' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(result.current.leProgress).toEqual({ phase: 'starting' });

      // A non-ok poll is ignored rather than shown as an error: the real request is the
      // one that decides whether issuance succeeded.
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(result.current.leProgress).toEqual({ phase: 'starting' });

      fetchMock.mockRejectedValueOnce(new Error('network blip'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(result.current.leProgress).toEqual({ phase: 'starting' });
      expect(showToast.error).not.toHaveBeenCalled();

      issue.resolve(ok(INSTALLED));
      await act(async () => {
        await pending;
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns auto-renewal off without touching the installed certificate', async () => {
    const { result } = await mount(INSTALLED);
    fetchMock.mockResolvedValueOnce(ok({ ...INSTALLED, acme: { managed: false } }));

    await act(async () => result.current.disableLetsEncrypt());

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'lets-encrypt-disable',
    });
    expect(result.current.tls).toMatchObject({ installed: true });
    expect(showToast.success).toHaveBeenCalledWith(
      'Auto-renewal turned off. The current certificate stays in place.',
    );
  });

  it('reports a failure to turn auto-renewal off', async () => {
    const { result } = await mount(INSTALLED);
    fetchMock.mockResolvedValueOnce(fail({}));

    await act(async () => result.current.disableLetsEncrypt());

    expect(showToast.error).toHaveBeenCalledWith('The certificate operation failed.');
    expect(result.current.tlsBusy).toBe(false);
  });
});
