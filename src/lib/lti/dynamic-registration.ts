/**
 * Registering AFCT with an LMS in one step, instead of copying eight values between two screens.
 *
 * Manual registration is mutual and tedious: four values go from AFCT into the LMS, six come
 * back, and one typo in any of them fails at a different stage of a launch with an error that
 * rarely names the field. LTI Dynamic Registration (1EdTech, built on OpenID Connect Dynamic
 * Client Registration) replaces the whole exchange with two HTTP calls between the two servers.
 *
 * The flow, as the spec defines it:
 *
 *   1. An administrator gives their LMS a URL that starts registration. Here that is
 *      `/lti/register` carrying a one-time token, minted in System Settings.
 *   2. The LMS opens it in a frame, adding `openid_configuration` (where its own settings can be
 *      read) and usually `registration_token` (a short-lived credential for step 4).
 *   3. AFCT reads that configuration: the issuer, the three endpoints it needs, and what the
 *      platform supports.
 *   4. AFCT posts its own description back to the platform's registration endpoint, and the
 *      platform answers with the client ID it has just assigned, plus (in practice, though the
 *      spec makes it optional) a deployment ID.
 *   5. AFCT saves that as a registration and tells the frame it is finished.
 *
 * Nothing here writes to the database. The route does that, so that the ordering of "spend the
 * token, then register" stays visible in one place.
 *
 * Two rules hold throughout, both because this runs on behalf of somebody who is not signed in:
 * every URL taken from the platform must be https, and every request out is bounded by a timeout.
 */

import { z } from 'zod';
import { AGS_SCOPES } from '@/lib/lti/access-token';
import { NRPS_SCOPES } from '@/lib/lti/nrps';

/** Where the platform describes itself, inside its OpenID configuration. */
export const PLATFORM_CONFIGURATION_CLAIM =
  'https://purl.imsglobal.org/spec/lti-platform-configuration';

/** Where AFCT describes itself, inside the registration it sends. */
export const TOOL_CONFIGURATION_CLAIM = 'https://purl.imsglobal.org/spec/lti-tool-configuration';

/**
 * What AFCT asks to be allowed to do.
 *
 * Taken from the two places that actually spend them rather than restated, so a scope added for
 * grade passback or roster reading cannot be forgotten here and then be missing from every
 * registration made this way.
 */
export const REQUESTED_SCOPES: readonly string[] = [...AGS_SCOPES, ...NRPS_SCOPES];

/** Nothing on the outside gets to make AFCT wait. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long a registration link lasts.
 *
 * An hour, matching the platform's own registration token, which the spec says is "typically 1
 * hour". A link that outlived the token it is used with would fail at the far end with an error
 * from the LMS instead of a clear one from AFCT.
 */
export const REGISTRATION_LINK_TTL_MS = 60 * 60 * 1000;

/** A URL the platform gave us, refused unless it is https. */
const platformUrl = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https:// address');

const PlatformConfigurationSchema = z.object({
  issuer: z.string().trim().min(1),
  authorization_endpoint: platformUrl,
  token_endpoint: platformUrl,
  jwks_uri: platformUrl,
  registration_endpoint: platformUrl,
  /** What the platform is prepared to grant. Absent means it did not say. */
  scopes_supported: z.array(z.string()).optional(),
  [PLATFORM_CONFIGURATION_CLAIM]: z
    .object({
      product_family_code: z.string().optional(),
      version: z.string().optional(),
    })
    .loose()
    .optional(),
});

export type PlatformConfiguration = z.infer<typeof PlatformConfigurationSchema>;

/**
 * The platform's answer to a registration request.
 *
 * Only three fields are read. Everything else a platform echoes back is its own business, and a
 * strict schema here would fail registrations over fields AFCT has no opinion about.
 */
const RegistrationResponseSchema = z
  .object({
    // Numeric client IDs exist in the wild, so this is widened rather than assumed.
    client_id: z.union([z.string().trim().min(1), z.number()]).transform(String),
    scope: z.string().optional(),
    /**
     * Where Canvas puts the deployment it has just created.
     *
     * The spec says a platform combining registration with deployment "may also include the
     * deployment_id in the LTI Tool Configuration section", and Canvas puts it at the top level
     * instead (`dynamic_registration_controller.rb`, `render_registration`). Reading only the
     * spec's location made every Canvas registration fail on a value Canvas had already sent,
     * so both are read and neither is assumed.
     */
    deployment_id: z.union([z.string().trim().min(1), z.number()]).optional(),
    [TOOL_CONFIGURATION_CLAIM]: z
      .object({ deployment_id: z.union([z.string().trim().min(1), z.number()]).optional() })
      .loose()
      .optional(),
  })
  .loose();

/** Everything that can go wrong, in the words the administrator watching should read. */
export type RegistrationFailure = {
  ok: false;
  /** What to tell the person. Says what to do next, not what threw. */
  message: string;
  /** Short machine-ish tag, for the activity log. */
  reason: string;
};

const fail = (reason: string, message: string): RegistrationFailure => ({
  ok: false,
  reason,
  message,
});

/** Read the platform's OpenID configuration. */
export async function fetchPlatformConfiguration(
  url: string,
): Promise<{ ok: true; config: PlatformConfiguration } | RegistrationFailure> {
  if (platformUrl.safeParse(url).success === false) {
    return fail(
      'bad-configuration-url',
      'Your LMS sent a settings address that is not a secure https:// URL, so AFCT stopped rather than trusting it.',
    );
  }

  /**
   * Redirects are not followed, on either call.
   *
   * The https check above is worth nothing if the address can hand AFCT on to somewhere that
   * would not have passed it, and the registration POST below carries the platform's own
   * registration token, which must not be delivered to a host the administrator never saw. A
   * platform that redirects its own well-known configuration has misconfigured itself, and
   * saying so is more useful than quietly following it.
   */
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return fail(
      'configuration-unreachable',
      'AFCT could not reach your LMS to read its settings. Check that this AFCT server can reach it, then start the registration again.',
    );
  }

  if (response.status >= 300 && response.status < 400) {
    return fail(
      'configuration-redirected',
      `Your LMS redirected AFCT to ${response.headers.get('location') ?? 'somewhere it did not name'} when asked for its settings. Registration needs the address your LMS publishes, not one it forwards to.`,
    );
  }

  if (!response.ok) {
    return fail(
      'configuration-refused',
      `Your LMS refused to give AFCT its settings (HTTP ${response.status}). Start the registration again from your LMS; the link it gave AFCT may have expired.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fail(
      'configuration-unparseable',
      'Your LMS answered with something that is not the settings AFCT expected. It may not support automatic registration.',
    );
  }

  const parsed = PlatformConfigurationSchema.safeParse(body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') || 'its settings';
    return fail(
      'configuration-incomplete',
      `Your LMS's settings are missing or malformed (${field}), so AFCT cannot register with it automatically. Register it by hand under System Settings, LTI.`,
    );
  }

  return { ok: true, config: parsed.data };
}

/** The scopes to ask for: what AFCT needs, narrowed to what the platform says it offers. */
export function scopesToRequest(config: PlatformConfiguration): string[] {
  const supported = config.scopes_supported;
  // A platform that lists nothing has not said it supports nothing; it has said nothing. Asking
  // for everything is right there, and the platform still decides what it grants.
  if (!supported || supported.length === 0) return [...REQUESTED_SCOPES];
  return REQUESTED_SCOPES.filter((scope) => supported.includes(scope));
}

export type ToolRegistration = Record<string, unknown>;

/**
 * How AFCT describes itself to a platform.
 *
 * The URLs are the same four an administrator would otherwise copy by hand, built from the
 * configured public address for the reasons in `public-url.ts`.
 */
export function buildToolRegistration(opts: {
  baseUrl: string;
  config: PlatformConfiguration;
}): ToolRegistration {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const launchUrl = `${base}/api/lti/launch`;
  const domain = (() => {
    try {
      return new URL(base).host;
    } catch {
      return base;
    }
  })();

  return {
    application_type: 'web',
    // Both are required by the spec: implicit carries the launch, client_credentials gets the
    // token that grades and rosters are sent with.
    grant_types: ['client_credentials', 'implicit'],
    response_types: ['id_token'],
    redirect_uris: [launchUrl],
    initiate_login_uri: `${base}/api/lti/login`,
    client_name: 'AFCT',
    jwks_uri: `${base}/api/lti/jwks`,
    token_endpoint_auth_method: 'private_key_jwt',
    scope: scopesToRequest(opts.config).join(' '),
    [TOOL_CONFIGURATION_CLAIM]: {
      domain,
      target_link_uri: launchUrl,
      description: 'Automata and formal language coursework, with automatic feedback.',
      // Only what a launch is matched or personalised on. AFCT asks for no more than it uses.
      claims: ['iss', 'sub', 'name', 'given_name', 'family_name', 'email'],
      messages: [
        {
          type: 'LtiDeepLinkingRequest',
          target_link_uri: launchUrl,
          label: 'Add an AFCT assignment',
          placements: ['ContentArea'],
        },
        {
          type: 'LtiResourceLinkRequest',
          target_link_uri: launchUrl,
          label: 'AFCT',
        },
      ],
    },
  };
}

export type RegistrationResult = {
  ok: true;
  /** Ready to become an `LtiPlatform` row. */
  platform: {
    name: string;
    issuer: string;
    clientId: string;
    deploymentId: string;
    authLoginUrl: string;
    tokenUrl: string;
    keysetUrl: string;
  };
  /** Things the administrator should know but which did not stop the registration. */
  notes: string[];
};

/** What to call this registration on screen. A label only; nothing is ever matched on it. */
export function registrationName(config: PlatformConfiguration): string {
  const family = config[PLATFORM_CONFIGURATION_CLAIM]?.product_family_code?.toLowerCase() ?? '';
  const known: Record<string, string> = {
    canvas: 'Canvas',
    moodle: 'Moodle',
    desire2learn: 'D2L Brightspace',
    d2l: 'D2L Brightspace',
    blackboard: 'Blackboard',
    sakai: 'Sakai',
  };
  /**
   * Where the platform answers, in preference to what it calls itself.
   *
   * Canvas reports the issuer `https://canvas.instructure.com` however it is hosted, so naming a
   * registration from the issuer calls every institution's Canvas the same thing. The token
   * endpoint is the address the LMS really lives at, which is what distinguishes one from
   * another in a list. The same reasoning decides the frame-ancestors list in `proxy.ts`.
   */
  const host = (() => {
    for (const candidate of [config.token_endpoint, config.issuer]) {
      try {
        // An empty host, not a throw, is what a non-http identifier gives: `new URL` accepts
        // `urn:lms:example` happily and reports no host at all.
        const host = new URL(candidate).host;
        if (host) return host;
      } catch {
        // The issuer is an identifier, not necessarily a URL. Fall through to the next one.
      }
    }
    return config.issuer;
  })();

  const product = known[family];
  return product ? `${product} (${host})` : host;
}

/** Send the registration and turn the answer into the fields a registration row needs. */
export async function requestRegistration(opts: {
  config: PlatformConfiguration;
  registrationToken?: string | null;
  baseUrl: string;
}): Promise<RegistrationResult | RegistrationFailure> {
  const body = buildToolRegistration({ baseUrl: opts.baseUrl, config: opts.config });

  let response: Response;
  try {
    response = await fetch(opts.config.registration_endpoint, {
      method: 'POST',
      // Never followed: this request carries the platform's registration token, and a 307 or
      // 308 would resend it, body and all, to whatever host the redirect named.
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Present on nearly every platform, and required to be used when it is. A platform that
        // sent none is expected to authorise the request some other way.
        ...(opts.registrationToken ? { Authorization: `Bearer ${opts.registrationToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return fail(
      'registration-unreachable',
      'AFCT could not reach your LMS to complete the registration. Check that this AFCT server can reach it, then start again.',
    );
  }

  if (response.status >= 300 && response.status < 400) {
    return fail(
      'registration-redirected',
      `Your LMS redirected the registration to ${response.headers.get('location') ?? 'somewhere it did not name'}. AFCT will not send your LMS's registration token to another address.`,
    );
  }

  if (!response.ok) {
    return fail(
      'registration-refused',
      `Your LMS refused the registration (HTTP ${response.status}). Registration links usually work only once and expire quickly, so start again from your LMS.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return fail(
      'registration-unparseable',
      'Your LMS accepted the registration but answered with something AFCT could not read, so nothing was saved.',
    );
  }

  const parsed = RegistrationResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return fail(
      'registration-incomplete',
      'Your LMS accepted the registration but did not send back a client ID, so AFCT has nothing to save. Register it by hand under System Settings, LTI.',
    );
  }

  const clientId = parsed.data.client_id;
  const deploymentId =
    parsed.data.deployment_id ?? parsed.data[TOOL_CONFIGURATION_CLAIM]?.deployment_id;
  if (deploymentId === undefined || String(deploymentId).trim() === '') {
    // The spec allows this, and no LMS anyone has tested does it. Refusing is better than saving
    // a registration no launch could ever match, and the client ID is quoted so the manual form
    // can still be filled in without going back to the LMS.
    return fail(
      'no-deployment-id',
      `Your LMS registered AFCT but did not send a deployment ID, which AFCT needs to recognise a launch. Add it by hand under System Settings, LTI, using client ID ${clientId}.`,
    );
  }

  const granted = parsed.data.scope;
  const notes: string[] = [];
  if (granted !== undefined && granted.trim() === '') {
    notes.push(
      'Your LMS granted no service permissions, so grade passback and roster sync will not work until they are turned on in the LMS.',
    );
  }
  const family = opts.config[PLATFORM_CONFIGURATION_CLAIM]?.product_family_code?.toLowerCase();
  if (family === 'desire2learn' || family === 'd2l') {
    // The one field dynamic registration cannot carry: Brightspace expects an audience of its
    // own in the client assertion, and hands it out on its own registration screen.
    notes.push(
      'Brightspace also needs its OAuth2 Audience, which is not part of an automatic registration. Add the LMS by hand as well if grades fail to send.',
    );
  }

  return {
    ok: true,
    platform: {
      name: registrationName(opts.config),
      issuer: opts.config.issuer,
      clientId,
      deploymentId: String(deploymentId),
      authLoginUrl: opts.config.authorization_endpoint,
      tokenUrl: opts.config.token_endpoint,
      keysetUrl: opts.config.jwks_uri,
    },
    notes,
  };
}
