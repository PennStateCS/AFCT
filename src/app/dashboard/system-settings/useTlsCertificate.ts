import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';

export type TlsInfo = {
  installed: boolean;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  selfSigned?: boolean;
  expired?: boolean;
  pendingCsr?: boolean;
};

export type TlsMethod = 'csr' | 'self-signed' | 'upload' | null;

const TLS_QUERY_KEY = ['admin', 'settings', 'tls'] as const;

/**
 * The TLS-certificate subsystem of the system-settings page: the cached status read,
 * the upload / CSR / self-signed flows, and their form state. Kept out of
 * SystemSettingsClient so that component owns only the main settings form. The read is
 * cached; every mutation writes the fresh info straight into the cache (via `setTls`) so
 * the status card stays current without a refetch.
 */
export function useTlsCertificate() {
  const queryClient = useQueryClient();

  const { data: tlsData } = useQuery({
    queryKey: TLS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(apiPaths.admin.settingsTls(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load TLS info');
      return (await res.json()) as TlsInfo;
    },
    staleTime: 30_000,
  });
  const tls = tlsData ?? null;
  const setTls = useCallback(
    (info: TlsInfo) => queryClient.setQueryData(TLS_QUERY_KEY, info),
    [queryClient],
  );

  const [tlsBusy, setTlsBusy] = useState(false);
  const [tlsMethod, setTlsMethod] = useState<TlsMethod>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [chainFile, setChainFile] = useState<File | null>(null);
  // CSR flow
  const [csrCommonName, setCsrCommonName] = useState('');
  const [csrOrganization, setCsrOrganization] = useState('');
  const [csrAltNames, setCsrAltNames] = useState('');
  const [signedCertFile, setSignedCertFile] = useState<File | null>(null);
  const [signedChainFile, setSignedChainFile] = useState<File | null>(null);

  const cnMissing = !csrCommonName.trim();

  const applyCert = async () => {
    if (!certFile || !keyFile) {
      showToast.error('Select both a certificate and a private key.');
      return;
    }
    setTlsBusy(true);
    try {
      const [cert, key, chain] = await Promise.all([
        certFile.text(),
        keyFile.text(),
        chainFile ? chainFile.text() : Promise.resolve(undefined),
      ]);
      const res = await fetch(apiPaths.admin.settingsTls(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cert, key, chain }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to apply certificate.');
      setTls(data as TlsInfo);
      setCertFile(null);
      setKeyFile(null);
      setChainFile(null);
      setTlsMethod(null);
      showToast.success('Certificate applied. It may take up to ~15 seconds to take effect.');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to apply certificate.');
    } finally {
      setTlsBusy(false);
    }
  };

  const resetCert = async () => {
    setTlsBusy(true);
    try {
      const res = await fetch(apiPaths.admin.settingsTls(), { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to reset certificate.');
      setTls(data as TlsInfo);
      showToast.success('Reverted to the self-signed certificate.');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to reset certificate.');
    } finally {
      setTlsBusy(false);
    }
  };

  const csrFieldsPayload = () => ({
    commonName: csrCommonName.trim(),
    organization: csrOrganization.trim() || undefined,
    altNames: csrAltNames
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });

  const tlsAction = async (payload: Record<string, unknown>) => {
    const res = await fetch(apiPaths.admin.settingsTls(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'The certificate operation failed.');
    return data;
  };

  const downloadText = (filename: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/x-pem-file' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateCsr = async () => {
    if (!csrCommonName.trim()) {
      showToast.error('Enter a hostname (Common Name) first.');
      return;
    }
    setTlsBusy(true);
    try {
      const data = await tlsAction({ action: 'generate-csr', ...csrFieldsPayload() });
      if (data?.csr) downloadText('afct.csr', data.csr as string);
      setTls(data as TlsInfo);
      showToast.success(
        'CSR generated and downloaded. Send it to your CA to get a signed certificate.',
      );
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to generate CSR.');
    } finally {
      setTlsBusy(false);
    }
  };

  const installSignedCert = async () => {
    if (!signedCertFile) {
      showToast.error('Choose the certificate returned by your CA.');
      return;
    }
    setTlsBusy(true);
    try {
      const [cert, chain] = await Promise.all([
        signedCertFile.text(),
        signedChainFile ? signedChainFile.text() : Promise.resolve(undefined),
      ]);
      const data = await tlsAction({ action: 'install-signed', cert, chain });
      setTls(data as TlsInfo);
      setSignedCertFile(null);
      setSignedChainFile(null);
      setTlsMethod(null);
      showToast.success(
        'Signed certificate installed. It may take up to ~15 seconds to take effect.',
      );
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to install certificate.');
    } finally {
      setTlsBusy(false);
    }
  };

  const generateSelfSigned = async () => {
    if (!csrCommonName.trim()) {
      showToast.error('Enter a hostname (Common Name) first.');
      return;
    }
    setTlsBusy(true);
    try {
      const data = await tlsAction({ action: 'self-signed', ...csrFieldsPayload() });
      setTls(data as TlsInfo);
      setTlsMethod(null);
      showToast.success('Self-signed certificate generated and applied for that hostname.');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to generate certificate.');
    } finally {
      setTlsBusy(false);
    }
  };

  return {
    tls,
    tlsBusy,
    tlsMethod,
    setTlsMethod,
    certFile,
    setCertFile,
    keyFile,
    setKeyFile,
    chainFile,
    setChainFile,
    csrCommonName,
    setCsrCommonName,
    csrOrganization,
    setCsrOrganization,
    csrAltNames,
    setCsrAltNames,
    signedCertFile,
    setSignedCertFile,
    signedChainFile,
    setSignedChainFile,
    cnMissing,
    applyCert,
    resetCert,
    generateCsr,
    installSignedCert,
    generateSelfSigned,
  };
}
