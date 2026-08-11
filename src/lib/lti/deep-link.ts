/**
 * Answering a deep-linking request.
 *
 * The platform asks a member of staff to choose something; AFCT signs the choice and the
 * browser posts it back. Signed with AFCT's own key, so the platform can verify the answer came
 * from the tool rather than from whoever happened to be at the keyboard.
 *
 * Note the direction: everything else in LTI has the platform signing and AFCT verifying. Here
 * it is the other way round, which is why this needs the keypair and why an unreachable JWKS
 * breaks it.
 */

import { SignJWT, importPKCS8 } from 'jose';
import { getSigningKey, LTI_SIGNING_ALG } from '@/lib/lti/keys';

const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim';
const DL_CLAIM = 'https://purl.imsglobal.org/spec/lti-dl/claim';

/** Short: it is signed, submitted and consumed within seconds. */
const RESPONSE_TTL_S = 5 * 60;

/** One AFCT assignment, as the platform will store it. */
export type DeepLinkItem = {
  /** Where the platform should send people when they open it. */
  url: string;
  title: string;
  /** Points, when the platform should create a gradebook column for it. */
  scoreMaximum?: number | null;
  /** The AFCT assignment, so a launch through this link knows what it opens. */
  assignmentId: string;
};

export type DeepLinkResponse =
  { ok: true; returnUrl: string; jwt: string } | { ok: false; reason: 'no-signing-key' };

/**
 * Sign the chosen items for return to the platform.
 *
 * `data` is the platform's own opaque state and must come back exactly as it arrived; platforms
 * reject a response without it, and it is how they know which placement asked.
 */
export async function buildDeepLinkResponse(opts: {
  platform: { issuer: string; clientId: string; deploymentId: string };
  returnUrl: string;
  data: string | null;
  items: DeepLinkItem[];
}): Promise<DeepLinkResponse> {
  const signing = await getSigningKey();
  if (!signing) return { ok: false, reason: 'no-signing-key' };

  const key = await importPKCS8(signing.privateKey, LTI_SIGNING_ALG);

  const contentItems = opts.items.map((item) => ({
    type: 'ltiResourceLink',
    url: item.url,
    title: item.title,
    // Carried back on every launch through this link, which is how AFCT knows which assignment
    // a click means without asking again.
    custom: { afct_assignment_id: item.assignmentId },
    ...(item.scoreMaximum
      ? { lineItem: { scoreMaximum: item.scoreMaximum, label: item.title } }
      : {}),
  }));

  const jwt = await new SignJWT({
    [`${CLAIM}/message_type`]: 'LtiDeepLinkingResponse',
    [`${CLAIM}/version`]: '1.3.0',
    [`${CLAIM}/deployment_id`]: opts.platform.deploymentId,
    [`${DL_CLAIM}/content_items`]: contentItems,
    ...(opts.data ? { [`${DL_CLAIM}/data`]: opts.data } : {}),
  })
    .setProtectedHeader({ alg: LTI_SIGNING_ALG, kid: signing.kid })
    // Reversed from a launch: AFCT is the issuer here and the platform is the audience.
    .setIssuer(opts.platform.clientId)
    .setAudience(opts.platform.issuer)
    .setIssuedAt()
    .setExpirationTime(`${RESPONSE_TTL_S}s`)
    .setJti(crypto.randomUUID())
    .sign(key);

  return { ok: true, returnUrl: opts.returnUrl, jwt };
}

/**
 * The page that returns the answer.
 *
 * A self-submitting form, because the response has to reach the platform as a POST from the
 * browser and there is nowhere else to put a JWT that long.
 *
 * The script carries the request's CSP nonce or it is blocked outright in production, where the
 * policy is enforced. The button is always visible rather than inside `<noscript>`, because a
 * blocked script is not the same as a disabled one: `<noscript>` would stay hidden and leave
 * somebody on a page that does nothing.
 */
export function deepLinkReturnHtml(returnUrl: string, jwt: string, nonce?: string | null): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Returning to your LMS</title></head>
<body>
<form id="dl" method="POST" action="${escape(returnUrl)}">
  <input type="hidden" name="JWT" value="${escape(jwt)}">
  <button type="submit">Return to your LMS</button>
</form>
<p role="status">Returning to your LMS...</p>
<script${nonce ? ` nonce="${escape(nonce)}"` : ''}>document.getElementById('dl').submit();</script>
</body>
</html>`;
}
