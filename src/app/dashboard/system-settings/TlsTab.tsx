'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';
import FileUploadInput from '@/components/FileUploadInput';
import { useTlsCertificate } from './useTlsCertificate';
import { StepList } from './StepList';
import { deriveAcmeSteps } from './system-settings-shared';
import {
  SettingsSection,
  SettingsStatusCard,
  SettingsAsideLayout,
  SettingsStatusText,
} from './settings-layout';

/**
 * One fact about the installed certificate, label above value.
 *
 * The rail is 18rem, so an inline "Issued to: host.example.edu" wraps the value onto its own
 * line anyway; stacking it deliberately gets the same height with a scannable label column.
 */
function CertMeta({ label, value, wrap }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={`text-foreground text-sm${wrap ? 'break-all' : ''}`}>{value}</div>
    </div>
  );
}

/** TLS Certificate tab: current status plus the upload / CSR / self-signed / Let's Encrypt flows. */
export function TlsTab({ configuredUrl }: { configuredUrl: string | undefined }) {
  const {
    tls,
    tlsBusy,
    leProgress,
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
    leDomain,
    setLeDomain,
    leEmail,
    setLeEmail,
    leStaging,
    setLeStaging,
    leTos,
    setLeTos,
    cnMissing,
    applyCert,
    resetCert,
    generateCsr,
    installSignedCert,
    generateSelfSigned,
    requestLetsEncrypt,
    disableLetsEncrypt,
  } = useTlsCertificate();

  // Both of these change HTTPS for every visitor, so confirm before running them.
  const [tlsConfirm, setTlsConfirm] = useState<null | 'reset' | 'disable-renew'>(null);

  return (
    <>
      <SettingsAsideLayout
        aside={
          <SettingsStatusCard
            title="Current certificate"
            /* The tab decides what the certificate IS; the card only decides how a state
               looks. Expired and self-signed are both "browsers will warn", which is a
               warning rather than a failure: the site is still reachable and encrypted. */
            tone={!tls?.installed || tls.expired || tls.selfSigned ? 'warn' : 'ok'}
            badge={
              !tls?.installed ? (
                <Badge variant="warning">Self-signed (built-in)</Badge>
              ) : tls.expired ? (
                <Badge variant="warning">Expired</Badge>
              ) : tls.selfSigned ? (
                <Badge variant="warning">Self-signed certificate</Badge>
              ) : (
                <Badge variant="success">Trusted certificate</Badge>
              )
            }
            headline={
              !tls?.installed
                ? 'Using the built-in certificate'
                : tls.expired
                  ? 'This certificate has expired'
                  : tls.selfSigned
                    ? 'Browsers will warn visitors'
                    : 'Certificate is trusted'
            }
          >
            <SettingsStatusText>
              {!tls?.installed
                ? 'The connection is still encrypted, but browsers will show a security warning until you install a trusted certificate.'
                : tls.expired
                  ? 'Browsers will show a security warning until you install a valid one.'
                  : tls.selfSigned
                    ? 'It is not issued by a trusted authority, so browsers will show a security warning.'
                    : 'Visitors will not see a security warning.'}
            </SettingsStatusText>

            {/* Stacked label over value, not "Issued to: foo" inline: in an 18rem rail the
                inline form wraps the value onto its own line anyway, so this costs the same
                height and gains a label column you can scan. */}
            {tls?.installed && (tls.subject || tls.validTo) ? (
              <div className="space-y-3 pt-1">
                {tls.subject && <CertMeta label="Issued to" value={tls.subject} wrap />}
                {tls.validTo && <CertMeta label="Valid until" value={tls.validTo} />}
              </div>
            ) : null}

            {tls?.acme?.managed && (
              // A second status inside the same card, separated by a rule rather than by a
              // nested card: renewal is a fact about the certificate above, not a new topic.
              <div className="space-y-3 border-t pt-3">
                <Badge variant="success" className="w-fit">
                  Auto-renewing
                </Badge>
                <CertMeta
                  label={`Let’s Encrypt${tls.acme.staging ? ' (staging)' : ''}`}
                  value={tls.acme.domain}
                  wrap
                />
                <SettingsStatusText>Renews automatically before expiry.</SettingsStatusText>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setTlsConfirm('disable-renew')}
                  disabled={tlsBusy}
                >
                  Turn off auto-renewal
                </Button>
              </div>
            )}
          </SettingsStatusCard>
        }
      >
        {/* A CSR was generated but its signed cert isn't installed yet. */}
        {tls?.pendingCsr && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="warning">CSR pending</Badge>
            <span className="text-muted-foreground">
              A request is waiting for its signed certificate.
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => setTlsMethod('csr')}>
              Finish CSR
            </Button>
          </div>
        )}

        <SettingsSection title="Set up a certificate">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Certificate setup method">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                // Prefill the domain from the configured public URL's host.
                if (!leDomain && configuredUrl) {
                  try {
                    setLeDomain(new URL(configuredUrl).hostname);
                  } catch {
                    // leave blank if the URL can't be parsed
                  }
                }
                setTlsMethod('lets-encrypt');
              }}
            >
              Get a free certificate (Let’s Encrypt)
            </Button>
            <Button type="button" size="sm" onClick={() => setTlsMethod('csr')}>
              Request a CA-signed certificate
            </Button>
            <Button type="button" size="sm" onClick={() => setTlsMethod('self-signed')}>
              Create a self-signed certificate
            </Button>
            <Button type="button" size="sm" onClick={() => setTlsMethod('upload')}>
              Upload an existing certificate
            </Button>
          </div>
        </SettingsSection>

        {/* Let's Encrypt (ACME HTTP-01) form (modal) */}
        <Dialog
          open={tlsMethod === 'lets-encrypt'}
          onOpenChange={(open) => {
            if (!open) setTlsMethod(null);
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Get a free certificate (Let’s Encrypt)</DialogTitle>
              <DialogDescription>
                Automatically obtain and renew a browser-trusted certificate from Let’s Encrypt.
                This works only for a public server.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <div
                role="note"
                className="border-status-warning-border bg-status-warning-bg text-status-warning rounded-md border p-3 text-xs"
              >
                Before you start: this domain must point at this server in public DNS, and port 80
                must be reachable from the internet (that is how Let’s Encrypt verifies you control
                the domain). Installing a trusted certificate also turns on HSTS, which tells
                browsers to use HTTPS for this domain going forward.
              </div>
              <InputGroup
                label="Domain"
                name="leDomain"
                requiredMark
                placeholder="afct.example.edu"
                value={leDomain}
                setValue={setLeDomain}
                disabled={tlsBusy}
                description="The public hostname visitors use. Should match your configured URL."
              />
              <InputGroup
                label="Contact email"
                name="leEmail"
                type="email"
                // Whoever should hear about certificate expiry, not necessarily whoever
                // is filling the form in.
                autoComplete="off"
                requiredMark
                placeholder="admin@example.edu"
                value={leEmail}
                setValue={setLeEmail}
                disabled={tlsBusy}
                description="Let’s Encrypt uses this only for expiry and policy notices."
              />
              <SwitchField
                id="le-staging"
                name="le-staging"
                label="Use staging (for testing)"
                checked={leStaging}
                onCheckedChange={setLeStaging}
                disabled={tlsBusy}
                descriptionPlacement="inline"
                description="Issues an untrusted test certificate from the staging environment. Use this first to confirm setup without spending the weekly rate limit."
              />
              <SwitchField
                id="le-tos"
                name="le-tos"
                label="I agree to the Let’s Encrypt terms of service"
                checked={leTos}
                onCheckedChange={setLeTos}
                disabled={tlsBusy}
                descriptionPlacement="inline"
                description="Required to request a certificate."
              />
              {leProgress && (
                <div role="status" className="bg-muted space-y-2 rounded-md border p-3 text-sm">
                  {deriveAcmeSteps(leProgress.phase) && (
                    <StepList
                      steps={deriveAcmeSteps(leProgress.phase)!}
                      ariaLabel="Certificate issuance progress"
                    />
                  )}
                  {leProgress.message && (
                    <p className="text-muted-foreground text-xs">{leProgress.message}</p>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTlsMethod(null)}
                disabled={tlsBusy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={requestLetsEncrypt}
                disabled={tlsBusy || !leDomain.trim() || !leEmail.trim() || !leTos}
              >
                {tlsBusy ? 'Requesting… (up to a minute)' : 'Request certificate'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Generate CSR / self-signed hostname form (modal) */}
        <Dialog
          open={tlsMethod === 'csr' || tlsMethod === 'self-signed'}
          onOpenChange={(open) => {
            if (!open) setTlsMethod(null);
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {tlsMethod === 'csr'
                  ? 'Request a CA-signed certificate'
                  : 'Create a self-signed certificate'}
              </DialogTitle>
              <DialogDescription>
                {tlsMethod === 'csr'
                  ? 'Enter your hostname and generate a CSR to send to your certificate authority. The private key is created and kept on the server.'
                  : 'Generate a self-signed certificate for this hostname — no certificate authority needed (browsers still warn unless trusted internally).'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <InputGroup
                label="Hostname (Common Name)"
                name="csrCommonName"
                requiredMark
                placeholder="afct.example.edu"
                value={csrCommonName}
                setValue={setCsrCommonName}
                disabled={tlsBusy}
                description="The DNS name (or IP) the server is reached at."
              />
              <InputGroup
                label="Organization (optional)"
                name="csrOrganization"
                placeholder="Penn State Wilkes-Barre"
                value={csrOrganization}
                setValue={setCsrOrganization}
                disabled={tlsBusy}
                description="Your school or organization name, included in the certificate."
              />
              <InputGroup
                label="Additional hostnames / SANs (optional)"
                name="csrAltNames"
                placeholder="www.example.edu, 10.0.0.5"
                value={csrAltNames}
                setValue={setCsrAltNames}
                disabled={tlsBusy}
                description="Comma-separated extra DNS names or IPs."
              />
            </div>

            {tlsMethod === 'csr' && tls?.pendingCsr && (
              <div className="bg-muted space-y-3 rounded-md border p-3">
                <p className="text-sm">
                  CSR generated (<span className="font-mono text-xs">afct.csr</span>). Upload the
                  signed certificate from your CA:
                </p>
                <div className="space-y-4">
                  <FileUploadInput
                    id="tls-signed-cert"
                    name="tls-signed-cert"
                    label="Signed certificate (PEM)"
                    accept=".crt,.pem,.cer"
                    maxSizeMb={5}
                    disabled={tlsBusy}
                    value={signedCertFile ?? undefined}
                    onChange={(f) => setSignedCertFile(f ?? null)}
                  />
                  <FileUploadInput
                    id="tls-signed-chain"
                    name="tls-signed-chain"
                    label="Chain / intermediates (optional)"
                    accept=".crt,.pem,.cer"
                    maxSizeMb={5}
                    disabled={tlsBusy}
                    value={signedChainFile ?? undefined}
                    onChange={(f) => setSignedChainFile(f ?? null)}
                  />
                </div>
                <Button
                  type="button"
                  onClick={installSignedCert}
                  disabled={tlsBusy || !signedCertFile}
                >
                  Install signed certificate
                </Button>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTlsMethod(null)}
                disabled={tlsBusy}
              >
                Cancel
              </Button>
              {tlsMethod === 'csr' ? (
                <Button type="button" onClick={generateCsr} disabled={tlsBusy || cnMissing}>
                  {tlsBusy ? 'Working…' : 'Generate key & CSR'}
                </Button>
              ) : (
                <Button type="button" onClick={generateSelfSigned} disabled={tlsBusy || cnMissing}>
                  {tlsBusy ? 'Working…' : 'Generate self-signed certificate'}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Upload existing cert + key (modal) */}
        <Dialog
          open={tlsMethod === 'upload'}
          onOpenChange={(open) => {
            if (!open) setTlsMethod(null);
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Upload an existing certificate</DialogTitle>
              <DialogDescription>
                Upload a certificate and its matching private key (PEM).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <FileUploadInput
                id="tls-cert"
                name="tls-cert"
                label="Certificate (PEM)"
                accept=".crt,.pem,.cer"
                maxSizeMb={5}
                disabled={tlsBusy}
                value={certFile ?? undefined}
                onChange={(f) => setCertFile(f ?? null)}
              />
              <FileUploadInput
                id="tls-key"
                name="tls-key"
                label="Private key (PEM)"
                accept=".key,.pem"
                maxSizeMb={5}
                disabled={tlsBusy}
                value={keyFile ?? undefined}
                onChange={(f) => setKeyFile(f ?? null)}
              />
              <FileUploadInput
                id="tls-chain"
                name="tls-chain"
                label="Chain / intermediates (optional)"
                accept=".crt,.pem,.cer"
                maxSizeMb={5}
                disabled={tlsBusy}
                value={chainFile ?? undefined}
                onChange={(f) => setChainFile(f ?? null)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTlsMethod(null)}
                disabled={tlsBusy}
              >
                Cancel
              </Button>
              <Button type="button" onClick={applyCert} disabled={tlsBusy || !certFile || !keyFile}>
                {tlsBusy ? 'Applying…' : 'Apply certificate'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Footer note + reset */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground max-w-xl text-xs">
            The new certificate takes effect within about 15 seconds. If the new certificate is
            invalid, it’s rejected and the current one is kept in place, so the site stays
            reachable.
          </p>
          {tls?.installed && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTlsConfirm('reset')}
              disabled={tlsBusy}
            >
              Reset to self-signed
            </Button>
          )}
        </div>
      </SettingsAsideLayout>

      <ConfirmDialog
        open={tlsConfirm === 'reset'}
        variant="destructive"
        busy={tlsBusy}
        title="Reset to a self-signed certificate?"
        description="This replaces the current trusted certificate with a self-signed one. Every visitor will see a browser security warning until a trusted certificate is installed again."
        confirmText="Reset certificate"
        onConfirm={async () => {
          await resetCert();
          setTlsConfirm(null);
        }}
        onCancel={() => setTlsConfirm(null)}
      />

      <ConfirmDialog
        open={tlsConfirm === 'disable-renew'}
        busy={tlsBusy}
        title="Turn off automatic renewal?"
        description="The current certificate stays in place, but AFCT stops renewing it with Let's Encrypt. If it expires before you set up renewal again, visitors will see certificate errors."
        confirmText="Turn off auto-renewal"
        onConfirm={async () => {
          await disableLetsEncrypt();
          setTlsConfirm(null);
        }}
        onCancel={() => setTlsConfirm(null)}
      />
    </>
  );
}
