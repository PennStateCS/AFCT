import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLATFORM_CONFIGURATION_CLAIM,
  REQUESTED_SCOPES,
  TOOL_CONFIGURATION_CLAIM,
  buildToolRegistration,
  fetchPlatformConfiguration,
  registrationName,
  requestRegistration,
  scopesToRequest,
} from './dynamic-registration';

/**
 * Automatic registration, without a platform to register against.
 *
 * Everything here is one side of a two-server conversation, so the tests hold the other side:
 * what AFCT sends is asserted field by field against the spec's requirements, and what it does
 * with the answer is asserted against the answers a real LMS gives, including the ones that are
 * technically legal and unusable.
 */

const CONFIG_URL = 'https://lms.example.test/.well-known/openid-configuration';

const configuration = (overrides: Record<string, unknown> = {}) => ({
  issuer: 'https://lms.example.test',
  authorization_endpoint: 'https://lms.example.test/auth',
  token_endpoint: 'https://lms.example.test/token',
  jwks_uri: 'https://lms.example.test/jwks',
  registration_endpoint: 'https://lms.example.test/register',
  scopes_supported: [...REQUESTED_SCOPES],
  [PLATFORM_CONFIGURATION_CLAIM]: { product_family_code: 'canvas', version: '1.0' },
  ...overrides,
});

/** A `fetch` that answers once with the given status and body. */
function answering(status: number, body: unknown) {
  return vi.fn(async () =>
    typeof body === 'string'
      ? new Response(body, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading the platform configuration', () => {
  it('refuses an address that is not https, without asking the network', async () => {
    const fetchMock = answering(200, configuration());
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformConfiguration('http://lms.example.test/.well-known/x');

    expect(result.ok).toBe(false);
    // The point is not the message but that nothing was fetched: this runs for somebody who is
    // not signed in, so an http address must not become a request from AFCT's server.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the endpoints AFCT needs', async () => {
    vi.stubGlobal('fetch', answering(200, configuration()));

    const result = await fetchPlatformConfiguration(CONFIG_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.token_endpoint).toBe('https://lms.example.test/token');
    expect(result.config.registration_endpoint).toBe('https://lms.example.test/register');
  });

  it('refuses a configuration whose endpoints are not https', async () => {
    vi.stubGlobal(
      'fetch',
      answering(200, configuration({ token_endpoint: 'http://lms.example.test/token' })),
    );

    const result = await fetchPlatformConfiguration(CONFIG_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('configuration-incomplete');
    // Names the field, because that is what an administrator has to take to their LMS.
    expect(result.message).toContain('token_endpoint');
  });

  it('says so when the platform will not hand its settings over', async () => {
    vi.stubGlobal('fetch', answering(404, 'nope'));

    const result = await fetchPlatformConfiguration(CONFIG_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('configuration-refused');
    expect(result.message).toContain('404');
  });

  it('says so when the platform cannot be reached at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const result = await fetchPlatformConfiguration(CONFIG_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('configuration-unreachable');
  });

  it('says so when the answer is not the configuration document', async () => {
    vi.stubGlobal('fetch', answering(200, 'a login page, not json'));

    const result = await fetchPlatformConfiguration(CONFIG_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('configuration-unparseable');
  });
});

describe('the scopes AFCT asks for', () => {
  it('asks only for what the platform says it supports', () => {
    const config = configuration({
      scopes_supported: ['https://purl.imsglobal.org/spec/lti-ags/scope/score', 'openid'],
    }) as never;

    expect(scopesToRequest(config)).toEqual([
      'https://purl.imsglobal.org/spec/lti-ags/scope/score',
    ]);
  });

  it('asks for everything when the platform lists nothing', () => {
    // Listing nothing is not the same as supporting nothing, and the platform still decides
    // what it grants. Asking for less than AFCT needs would break grades silently.
    const config = configuration({ scopes_supported: undefined }) as never;

    expect(scopesToRequest(config)).toEqual([...REQUESTED_SCOPES]);
  });
});

describe('what AFCT tells the platform about itself', () => {
  const body = buildToolRegistration({
    baseUrl: 'https://afct.example.test/',
    config: configuration() as never,
  });
  const tool = body[TOOL_CONFIGURATION_CLAIM] as Record<string, unknown>;

  it('sends the values the spec requires', () => {
    expect(body.application_type).toBe('web');
    expect(body.response_types).toContain('id_token');
    // Both, and for different halves of LTI: implicit carries the launch, client_credentials
    // gets the token grades are sent with. A platform is entitled to refuse if either is absent.
    expect(body.grant_types).toEqual(expect.arrayContaining(['client_credentials', 'implicit']));
    expect(body.token_endpoint_auth_method).toBe('private_key_jwt');
  });

  it('points every URL at AFCT and never at the request that built it', () => {
    // A trailing slash on the configured URL used to double up; the LMS compares redirect_uris
    // literally, so `//api/lti/launch` is a failed launch with a message about nothing.
    expect(body.redirect_uris).toEqual(['https://afct.example.test/api/lti/launch']);
    expect(body.initiate_login_uri).toBe('https://afct.example.test/api/lti/login');
    expect(body.jwks_uri).toBe('https://afct.example.test/api/lti/jwks');
    expect(tool.target_link_uri).toBe('https://afct.example.test/api/lti/launch');
    expect(tool.domain).toBe('afct.example.test');
  });

  it('offers deep linking, which is how faculty attach one assignment to a link', () => {
    const messages = tool.messages as Array<Record<string, unknown>>;
    expect(messages.map((message) => message.type)).toEqual(
      expect.arrayContaining(['LtiDeepLinkingRequest', 'LtiResourceLinkRequest']),
    );
  });

  it('asks for no personal claims beyond the ones a launch uses', () => {
    expect(tool.claims).toEqual(['iss', 'sub', 'name', 'given_name', 'family_name', 'email']);
  });
});

describe("the platform's answer", () => {
  const send = (registrationToken: string | null = 'platform-token') =>
    requestRegistration({
      config: configuration() as never,
      registrationToken,
      baseUrl: 'https://afct.example.test',
    });

  it("carries the platform's own token, and turns the answer into a registration", async () => {
    const fetchMock = answering(201, {
      client_id: 'client-9',
      scope: REQUESTED_SCOPES.join(' '),
      [TOOL_CONFIGURATION_CLAIM]: { deployment_id: 'deploy-9' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await send();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.platform).toMatchObject({
      issuer: 'https://lms.example.test',
      clientId: 'client-9',
      deploymentId: 'deploy-9',
      authLoginUrl: 'https://lms.example.test/auth',
      tokenUrl: 'https://lms.example.test/token',
      keysetUrl: 'https://lms.example.test/jwks',
    });
    expect(result.notes).toEqual([]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://lms.example.test/register');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer platform-token');
  });

  it('sends no authorization when the platform offered no token', async () => {
    const fetchMock = answering(200, {
      client_id: 'client-9',
      [TOOL_CONFIGURATION_CLAIM]: { deployment_id: 'deploy-9' },
    });
    vi.stubGlobal('fetch', fetchMock);

    await send(null);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('finds the deployment where Canvas puts it, at the top level', async () => {
    // Canvas's own response shape (`dynamic_registration_controller.rb`, render_registration):
    // the deployment it has just created is a top-level member, not part of the tool
    // configuration claim the spec describes. Reading only the spec's location made every real
    // Canvas registration fail on a value Canvas had already sent.
    vi.stubGlobal(
      'fetch',
      answering(200, {
        client_id: '10000000000003',
        scope: `${REQUESTED_SCOPES.join(' ')} openid`,
        [TOOL_CONFIGURATION_CLAIM]: { version: '1.3.0', domain: 'afct.example.test' },
        registration_client_uri: 'https://lms.example.test/api/lti/registrations/1',
        deployment_id: '3:8865aa05b4b79b64a91a86042e43af5ea8ae79eb',
      }),
    );

    const result = await send();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.platform.deploymentId).toBe('3:8865aa05b4b79b64a91a86042e43af5ea8ae79eb');
  });

  it('accepts a numeric client id, which some platforms send', async () => {
    vi.stubGlobal(
      'fetch',
      answering(200, {
        client_id: 10000000000123,
        [TOOL_CONFIGURATION_CLAIM]: { deployment_id: '1:abc' },
      }),
    );

    const result = await send();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.platform.clientId).toBe('10000000000123');
  });

  it('refuses a registration with no deployment id, quoting the client id', async () => {
    // The spec allows it and AFCT cannot use it: a launch is matched on the triple, so a row
    // without one would be refused at every launch with a message blaming the LMS.
    vi.stubGlobal('fetch', answering(200, { client_id: 'client-9' }));

    const result = await send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-deployment-id');
    expect(result.message).toContain('client-9');
  });

  it('says so when the platform granted no service permissions', async () => {
    vi.stubGlobal(
      'fetch',
      answering(200, {
        client_id: 'client-9',
        scope: '',
        [TOOL_CONFIGURATION_CLAIM]: { deployment_id: 'deploy-9' },
      }),
    );

    const result = await send();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.join(' ')).toContain('grade passback');
  });

  it('warns about Brightspace, whose audience cannot travel this way', async () => {
    vi.stubGlobal(
      'fetch',
      answering(200, {
        client_id: 'client-9',
        [TOOL_CONFIGURATION_CLAIM]: { deployment_id: 'deploy-9' },
      }),
    );

    const result = await requestRegistration({
      config: configuration({
        [PLATFORM_CONFIGURATION_CLAIM]: { product_family_code: 'desire2learn' },
      }) as never,
      registrationToken: 'platform-token',
      baseUrl: 'https://afct.example.test',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.join(' ')).toContain('Audience');
  });

  it('reports a refusal with the status, since these links expire quickly', async () => {
    vi.stubGlobal('fetch', answering(401, 'expired'));

    const result = await send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('registration-refused');
    expect(result.message).toContain('401');
  });
});

describe('naming a registration', () => {
  it('uses the product and the host, so a list of two Canvases is readable', () => {
    expect(registrationName(configuration() as never)).toBe('Canvas (lms.example.test)');
  });

  it('names the host the platform answers at, not the issuer it reports', () => {
    // Canvas reports `https://canvas.instructure.com` however it is hosted, so the issuer would
    // give every institution's Canvas the same name. Seen for real: a registration came back
    // called "Canvas (canvas.instructure.com)" from a self-hosted install.
    const config = configuration({ issuer: 'https://canvas.instructure.com' }) as never;

    expect(registrationName(config)).toBe('Canvas (lms.example.test)');
  });

  it('falls back to the host when the platform does not say what it is', () => {
    const config = configuration({ [PLATFORM_CONFIGURATION_CLAIM]: undefined }) as never;
    expect(registrationName(config)).toBe('lms.example.test');
  });

  it('survives an issuer that is not a URL, which the spec permits', () => {
    const config = configuration({
      issuer: 'urn:lms:example',
      [PLATFORM_CONFIGURATION_CLAIM]: undefined,
    }) as never;
    // Falls through to the token endpoint's host rather than showing nothing.
    expect(registrationName(config)).toBe('lms.example.test');
  });
});
