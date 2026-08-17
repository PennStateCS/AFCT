'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { LtiPlatformSchema } from '@/schemas/lti';

type Platform = {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  authLoginUrl: string;
  tokenUrl: string;
  tokenAudience: string;
  keysetUrl: string;
};

const EMPTY = {
  name: '',
  issuer: '',
  clientId: '',
  deploymentId: '',
  authLoginUrl: '',
  tokenUrl: '',
  tokenAudience: '',
  keysetUrl: '',
};

/**
 * LTI tab: which LMSs may open AFCT.
 *
 * Registration is mutual, so the tab has two halves. The values AFCT needs go in the form; the
 * values the LMS needs are listed above it, ready to copy.
 */
export function LtiTab({ siteUrl }: { siteUrl: string }) {
  const base = siteUrl.replace(/\/+$/, '');
  const [platforms, setPlatforms] = useState<Platform[] | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<Platform | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/lti/platforms');
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { platforms: Platform[] };
      setPlatforms(data.platforms);
    } catch {
      setPlatforms([]);
      showToast.error('Could not load the registered LMSs. Refresh the page to try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    // Checked here with the same schema the route uses, so a typo is caught next to the field
    // rather than after a round trip.
    const parsed = LtiPlatformSchema.safeParse(draft);
    if (!parsed.success) {
      showToast.error(parsed.error.issues[0]?.message ?? 'Check the values and try again.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/lti/platforms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast.error(
          data.error ?? 'Could not register that LMS. Check your connection and try again.',
        );
        return;
      }
      showToast.success('LMS registered');
      setDraft(EMPTY);
      setAdding(false);
      await load();
    } catch {
      showToast.error('Could not register that LMS. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    try {
      const res = await fetch(`/api/admin/lti/platforms/${removing.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast.success('Registration removed');
      setRemoving(null);
      await load();
    } catch {
      showToast.error('Could not remove that registration. Check your connection and try again.');
    }
  };

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <>
      <p className="text-muted-foreground mb-4 text-sm">
        Let people open AFCT from your LMS. Registration goes both ways: paste the values below into
        your LMS, then paste what it gives back into the form here.
      </p>

      <div className="mb-6 space-y-2">
        <h2 className="text-sm font-medium">Give these to your LMS</h2>
        <div className="max-w-2xl space-y-3 rounded-md border p-3">
          <InputGroup
            label="Target link URI"
            name="ltiTargetLinkUri"
            value={`${base}/api/lti/launch`}
            setValue={() => {}}
            readOnly
          />
          <InputGroup
            label="Login initiation URL"
            name="ltiLoginUrl"
            value={`${base}/api/lti/login`}
            setValue={() => {}}
            readOnly
          />
          <InputGroup
            label="Redirection URI"
            name="ltiRedirectUri"
            value={`${base}/api/lti/launch`}
            setValue={() => {}}
            readOnly
            description="Your LMS compares this exactly. A trailing slash or a different host is the usual cause of a failed launch."
          />
          <InputGroup
            label="Public keyset URL"
            name="ltiKeysetUrl"
            value={`${base}/api/lti/jwks`}
            setValue={() => {}}
            readOnly
          />
          <p className="text-muted-foreground text-xs">
            Your LMS reads the keyset URL from its own servers, not from a browser, so AFCT has to
            be reachable from your LMS. Grades will not reach it otherwise.
          </p>
        </div>
      </div>

      {/* Button beside the heading rather than pushed to the far edge, where it reads as
          belonging to the page rather than to this list. */}
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-sm font-medium">Registered LMSs</h2>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add an LMS
          </Button>
        )}
      </div>

      {platforms === null ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : platforms.length === 0 ? (
        <p className="text-muted-foreground mb-4 text-sm">
          No LMS is registered, so nobody can open AFCT from one yet.
        </p>
      ) : (
        <ul className="mb-4 max-w-2xl divide-y rounded-md border">
          {platforms.map((platform) => (
            <li key={platform.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{platform.name}</p>
                <p className="text-muted-foreground truncate text-xs">{platform.issuer}</p>
                <p className="text-muted-foreground truncate text-xs">
                  Client {platform.clientId}, deployment {platform.deploymentId}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRemoving(platform)}
                aria-label={`Remove ${platform.name}`}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="max-w-2xl space-y-4 rounded-md border p-4">
          <h3 className="text-sm font-medium">Add an LMS</h3>
          <p className="text-muted-foreground text-xs">
            Your LMS gives you these when you create a developer key for AFCT.
          </p>

          <InputGroup
            label="Name"
            name="lti-name"
            value={draft.name}
            setValue={set('name')}
            placeholder="Penn State Canvas"
          />
          <InputGroup
            label="Platform issuer"
            name="lti-issuer"
            value={draft.issuer}
            setValue={set('issuer')}
            placeholder="https://canvas.instructure.com"
          />
          <InputGroup
            label="Client ID"
            name="lti-client-id"
            value={draft.clientId}
            setValue={set('clientId')}
          />
          <InputGroup
            label="Deployment ID"
            name="lti-deployment-id"
            value={draft.deploymentId}
            setValue={set('deploymentId')}
          />
          <InputGroup
            label="Authorization URL"
            name="lti-auth-url"
            value={draft.authLoginUrl}
            setValue={set('authLoginUrl')}
          />
          <InputGroup
            label="Token URL"
            name="lti-token-url"
            value={draft.tokenUrl}
            setValue={set('tokenUrl')}
          />
          <InputGroup
            label="Public keyset URL"
            name="lti-keyset-url"
            value={draft.keysetUrl}
            setValue={set('keysetUrl')}
          />
          {/* Last, and described rather than labelled tersely, because almost nobody needs it and
              the one place it is needed is not guessable from the name. */}
          <InputGroup
            label="Token audience (optional)"
            name="lti-token-audience"
            value={draft.tokenAudience}
            setValue={set('tokenAudience')}
            description="Only D2L Brightspace needs this: use the Brightspace OAuth2 Audience from its registration. Leave it empty for Canvas, Moodle and Blackboard, which expect the token URL."
          />

          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? 'Registering...' : 'Register'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        title="Remove this registration?"
        description={`Nobody will be able to open AFCT from ${removing?.name ?? 'this LMS'} until it is registered again. Work already in AFCT is not affected.`}
        confirmText="Remove"
        variant="destructive"
        onConfirm={remove}
      />
    </>
  );
}
