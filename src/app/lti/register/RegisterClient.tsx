'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Registered = {
  platform: { name: string; issuer: string; clientId: string; deploymentId: string };
  notes: string[];
};

/**
 * The one screen of an automatic registration.
 *
 * It is seen inside an LMS frame, by an administrator who is in the middle of setting AFCT up
 * there, so it says what is about to happen in their words and then reports what did. On
 * success it also tells the LMS the flow is over, which is how the frame closes and the LMS
 * moves on to its own next step.
 */
export default function RegisterClient({
  token,
  openidConfiguration,
  registrationToken,
  platformHost,
}: {
  token: string;
  openidConfiguration: string;
  registrationToken: string | null;
  platformHost: string | null;
}) {
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<Registered | null>(null);
  const [error, setError] = useState<string | null>(null);

  const register = async () => {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch('/api/lti/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, openidConfiguration, registrationToken }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<Registered> & {
        error?: string;
      };
      if (!res.ok || !data.platform) {
        setError(
          data.error ??
            'The registration could not be completed. Create a new link in AFCT and try again.',
        );
        return;
      }
      setDone({ platform: data.platform, notes: data.notes ?? [] });
      // Tells the platform the flow is finished, so it can close the frame and carry on. The
      // spec names both the message and the wildcard target; the platform is on another origin
      // and AFCT has not been told which, so there is nothing narrower to send it to. Nothing
      // secret travels in it.
      try {
        (window.opener ?? window.parent)?.postMessage({ subject: 'org.imsglobal.lti.close' }, '*');
      } catch {
        // A platform that framed AFCT and then went away is not a failed registration. The
        // registration is saved either way, and the screen below says so.
      }
    } catch {
      setError('AFCT could not be reached. Check your connection and try again.');
    } finally {
      setWorking(false);
    }
  };

  if (done) {
    return (
      <main className="mx-auto max-w-lg p-6 text-sm">
        <h1 className="mb-2 text-base font-medium">{done.platform.name} is registered</h1>
        <p className="text-muted-foreground mb-4">
          People can now open AFCT from this LMS. Faculty connect their own courses the first time
          they open an AFCT link.
        </p>
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Issuer</dt>
          <dd className="break-all">{done.platform.issuer}</dd>
          <dt className="text-muted-foreground">Client ID</dt>
          <dd className="break-all">{done.platform.clientId}</dd>
          <dt className="text-muted-foreground">Deployment ID</dt>
          <dd className="break-all">{done.platform.deploymentId}</dd>
        </dl>
        {done.notes.length > 0 && (
          <ul className="mb-4 list-disc space-y-1 pl-5">
            {done.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground">You can close this window.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg p-6 text-sm">
      <h1 className="mb-2 text-base font-medium">Register this LMS with AFCT</h1>
      <p className="mb-4">
        {platformHost ? <strong>{platformHost}</strong> : 'Your LMS'} is asking to register with
        AFCT. Registering lets it sign people into AFCT, and lets AFCT send grades and read rosters
        for the courses that are linked to it.
      </p>
      <p className="text-muted-foreground mb-4">
        Only continue if you recognise the address above as your own LMS.
      </p>

      {/* One live region for this screen, so a failure is announced once and read where it is. */}
      <p role="status" aria-live="polite" className="text-destructive mb-4">
        {error ?? ''}
      </p>

      <Button onClick={() => void register()} disabled={working}>
        {working ? 'Registering...' : 'Register'}
      </Button>
    </main>
  );
}
