'use client';

import { useEffect, useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

type ClientToken = {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

/**
 * Tokens for the desktop client, on the account page.
 *
 * This is why the account page exists: a token list needs a table with labels, last-used dates
 * and a revoke action, and that does not belong in a dialog.
 *
 * A new token is shown **once**. That is a deliberate security property and an accessibility
 * problem at the same time, so the value is rendered as selectable text with a real label
 * rather than as something only a mouse can copy, and the copy result is announced.
 */
export function TokensSection() {
  // Dates in the course/effective timezone, like every other date the app shows, rather than
  // whatever the browser happens to be set to.
  const { timezone, hour12 } = useEffectiveTimezone();
  const [tokens, setTokens] = useState<ClientToken[] | null>(null);
  const [label, setLabel] = useState('');
  const [issuing, setIssuing] = useState(false);
  /** The plaintext of a token just issued. Held in memory only, and never fetched again. */
  const [justIssued, setJustIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ClientToken | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/me/client-tokens');
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { tokens: ClientToken[] };
      setTokens(data.tokens);
    } catch {
      setTokens([]);
      showToast.error('Could not load your tokens. Reload the page to try again.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const issue = async () => {
    setIssuing(true);
    try {
      const res = await fetch('/api/me/client-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { token: string };
      setJustIssued(data.token);
      setCopied(false);
      setLabel('');
      await load();
    } catch {
      showToast.error('Could not create a token. Try again.');
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async (token: ClientToken) => {
    try {
      const res = await fetch(`/api/me/client-tokens/${token.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast.success('Token revoked');
      await load();
    } catch {
      showToast.error('Could not revoke the token. Try again.');
    } finally {
      setRevoking(null);
    }
  };

  const copy = async () => {
    if (!justIssued) return;
    try {
      await navigator.clipboard.writeText(justIssued);
      setCopied(true);
    } catch {
      // Clipboard access can be refused. The value is on screen and selectable, so say that
      // rather than pretending the copy worked.
      showToast.error('Could not copy. Select the token and copy it manually.');
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground max-w-prose text-sm">
        The AFCT desktop client signs in with a token instead of your password. Create one here,
        paste it into the client, and revoke it if you stop using that machine.
      </p>

      {justIssued ? (
        <div className="border-status-info-border bg-status-info-bg space-y-3 rounded-md border p-4">
          <p className="text-sm font-medium">Your new token</p>
          {/* Rendered as a labelled, readonly field rather than decorative text: it has to be
              reachable and selectable by keyboard, since this is the only time it exists. */}
          <InputGroup
            name="new-client-token"
            label="Copy this now. It will not be shown again."
            value={justIssued}
            setValue={() => {}}
            readOnly
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy token
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setJustIssued(null)}>
              Done
            </Button>
          </div>
          {/* One live region for this area, so the copy result is announced once. */}
          <p role="status" aria-live="polite" className="text-sm">
            {copied ? 'Token copied to the clipboard.' : ''}
          </p>
        </div>
      ) : null}

      <div className="max-w-md space-y-3">
        <InputGroup
          name="token-label"
          label="Name this token"
          value={label}
          setValue={setLabel}
          disabled={issuing}
          placeholder="My laptop"
          description="Optional, but it is how you will tell your tokens apart later."
        />
        <Button type="button" onClick={() => void issue()} disabled={issuing}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {issuing ? 'Creating…' : 'Create token'}
        </Button>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Your tokens</h2>
        {tokens === null ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You have no tokens. Create one above if you use the desktop client.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Tokens you have issued for the desktop client</caption>
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Name
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Created
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Last used
                  </th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id} className="border-t">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">
                      {token.label || 'Unnamed token'}
                    </th>
                    <td className="py-2 pr-4">{formatDateTimeInTimeZone(token.createdAt, timezone, hour12)}</td>
                    <td className="text-muted-foreground py-2 pr-4">
                      {token.lastUsedAt
                        ? formatDateTimeInTimeZone(token.lastUsedAt, timezone, hour12)
                        : 'Never used'}
                    </td>
                    <td className="py-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRevoking(token)}
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {revoking ? (
        <ConfirmDialog
          open
          variant="destructive"
          title="Revoke this token?"
          description={`The client using ${revoking.label || 'this token'} will stop working immediately and will need a new one.`}
          confirmText="Revoke token"
          onConfirm={() => revoke(revoking)}
          onCancel={() => setRevoking(null)}
        />
      ) : null}
    </div>
  );
}

export default TokensSection;
