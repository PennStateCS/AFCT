import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The software half of the server status block.
 *
 * Two things worth pinning. The tool versions are read by shelling out, and a host without
 * Java is normal rather than an error - System Status has to render with those fields simply
 * absent, not fall over. And the deploy metadata is three long `??` chains over environment
 * variables from different hosting providers; reordering one changes what an operator is
 * shown with nothing failing, so the order is the thing under test.
 *
 * `collectSystem` is deliberately not covered here: it samples `/proc` twice around a sleep,
 * so a meaningful test would be mostly a re-implementation of the parser. Its pure helpers
 * are the part worth extracting if that changes.
 */

const { execSyncMock } = vi.hoisted(() => ({ execSyncMock: vi.fn() }));

vi.mock('child_process', () => ({ execSync: execSyncMock }));
// Pass straight through: the TTL cache would otherwise carry one test's answer into the next.
vi.mock('@/lib/status/cache', () => ({
  cached: (_key: string, _ttl: number, fn: () => unknown) => fn(),
  STATUS_TTL: { versions: 0 },
}));

import { collectSoftware } from './server';

/** The shape `java -version` writes (to stderr, which the command redirects). */
const JAVA_OUT = 'openjdk version "21.0.3" 2024-04-16\nOpenJDK Runtime Environment\n';

/** Route each exec by what is being run, so order does not matter. */
function execReturns({ java, evaluator }: { java?: string | Error; evaluator?: string | Error }) {
  execSyncMock.mockImplementation((cmd: string) => {
    const answer = cmd.includes('-jar') ? evaluator : java;
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error('not found');
    return answer;
  });
}

// Every variable the three chains read, cleared so the host's own environment cannot
// decide the result.
const ENV_KEYS = [
  'VERCEL_ENV', 'APP_ENV', 'ENVIRONMENT', 'NODE_ENV',
  'VERCEL_GIT_COMMIT_SHA', 'GIT_COMMIT', 'COMMIT_SHA', 'SOURCE_VERSION', 'GITHUB_SHA',
  'RENDER_GIT_COMMIT',
  'IMAGE_TAG', 'DOCKER_IMAGE_TAG', 'CONTAINER_IMAGE_TAG', 'IMAGE_VERSION', 'GIT_TAG',
  'VERCEL_GIT_COMMIT_REF',
];

beforeEach(() => {
  vi.clearAllMocks();
  // undefined, not '': the chains use ??, which falls through on nullish only, so an empty
  // string would stop the chain and every precedence test would read the first key.
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined);
  execReturns({ java: JAVA_OUT, evaluator: '{"version":"1.4.2"}' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('tool versions', () => {
  it('reads the Java version out of the banner', async () => {
    const software = await collectSoftware();

    expect(software.javaVersion).toBe('21.0.3');
  });

  it('reads the evaluator version from its JSON output', async () => {
    const software = await collectSoftware();

    expect(software.evaluatorVersion).toBe('1.4.2');
  });

  it('leaves both undefined when the tools are not installed, rather than failing', async () => {
    // A host without Java is a normal state for the status page, not an error condition.
    execReturns({});

    const software = await collectSoftware();

    expect(software.javaVersion).toBeUndefined();
    expect(software.evaluatorVersion).toBeUndefined();
    // The rest of the block still comes back, which is the point.
    expect(software.nodeVersion).toBe(process.version);
  });

  it('survives an evaluator that prints something other than JSON', async () => {
    execReturns({ java: JAVA_OUT, evaluator: 'Error: could not open jar' });

    expect((await collectSoftware()).evaluatorVersion).toBeUndefined();
  });

  it('survives a Java banner it cannot parse', async () => {
    execReturns({ java: 'some other tool entirely', evaluator: '{"version":"1.4.2"}' });

    expect((await collectSoftware()).javaVersion).toBeUndefined();
  });

  it('reports the Next version from the manifest', async () => {
    const software = await collectSoftware();

    expect(software.nextVersion).toEqual(expect.any(String));
  });
});

describe('deploy metadata precedence', () => {
  it('prefers VERCEL_ENV, then APP_ENV, ENVIRONMENT, NODE_ENV', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await collectSoftware()).deployEnv).toBe('production');

    vi.stubEnv('ENVIRONMENT', 'staging');
    expect((await collectSoftware()).deployEnv).toBe('staging');

    vi.stubEnv('APP_ENV', 'qa');
    expect((await collectSoftware()).deployEnv).toBe('qa');

    vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await collectSoftware()).deployEnv).toBe('preview');
  });

  it('takes the build hash from the first provider that sets one', async () => {
    vi.stubEnv('RENDER_GIT_COMMIT', 'render');
    expect((await collectSoftware()).buildHash).toBe('render');

    vi.stubEnv('GITHUB_SHA', 'github');
    expect((await collectSoftware()).buildHash).toBe('github');

    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'vercel');
    expect((await collectSoftware()).buildHash).toBe('vercel');
  });

  it('takes the image tag from the first provider that sets one', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'branch');
    expect((await collectSoftware()).imageTag).toBe('branch');

    vi.stubEnv('GIT_TAG', 'v1.2.3');
    expect((await collectSoftware()).imageTag).toBe('v1.2.3');

    vi.stubEnv('IMAGE_TAG', 'sha-abc');
    expect((await collectSoftware()).imageTag).toBe('sha-abc');
  });

  it('leaves the metadata out entirely when nothing sets it', async () => {
    // Undefined rather than an empty string: the UI hides an absent field and would
    // otherwise render a blank row.
    const software = await collectSoftware();

    expect(software.deployEnv).toBeUndefined();
    expect(software.buildHash).toBeUndefined();
    expect(software.imageTag).toBeUndefined();
  });
});
