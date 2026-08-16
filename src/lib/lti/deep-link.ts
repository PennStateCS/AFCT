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
  | { ok: true; returnUrl: string; jwt: string }
  | { ok: false; reason: 'no-signing-key' }
  /** The platform said it will not take the kind of thing AFCT has to offer. */
  | { ok: false; reason: 'type-not-accepted' };

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
  /** What the request said it will take. Required by DL 2.0, so this is never empty in practice. */
  acceptTypes: string[];
  /**
   * Whether the platform will take a gradebook column: true, false, or null for a request that
   * did not say. Null is not permission, so it is treated like false here.
   */
  acceptLineItem: boolean | null;
}): Promise<DeepLinkResponse> {
  /**
   * The platform states what it will accept and the tool is expected to honour it. AFCT has
   * only assignments to offer, so if a link to one is not on the list there is nothing to send
   * and saying so beats posting something that will be refused.
   *
   * Checked at launch too, which is where somebody finds out before picking anything. This is
   * the backstop for a pending choice whose stored settings say otherwise.
   */
  if (!opts.acceptTypes.includes('ltiResourceLink')) {
    return { ok: false, reason: 'type-not-accepted' };
  }

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
    /**
     * A column only when the assignment is worth something and the platform has actually said
     * it takes one. DL 2.0: with `accept_lineitem` absent "no assumption can be made about the
     * support of line items", so silence is not consent. Sending one anyway risks the platform
     * rejecting the whole response, which loses the staff member's choice rather than just the
     * column; a missing column is visible and fixable, a refused response is neither.
     */
    ...(item.scoreMaximum && opts.acceptLineItem === true
      ? { lineItem: { scoreMaximum: item.scoreMaximum, label: item.title } }
      : {}),
    /**
     * Open in a new tab, decided here rather than left to whoever adds the link.
     *
     * AFCT is a whole application: a student works through an automaton, submits, and reads
     * feedback. Inside the panel an LMS gives a tool that is cramped, and the browser back
     * button belongs to the LMS page rather than to their work. DL 2.0 lets the tool state
     * this, and Canvas honours it by ticking "Load this tool in a new tab" on the assignment
     * it creates, so the person adding the link no longer has to know to do it.
     */
    window: { targetName: '_blank' },
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
