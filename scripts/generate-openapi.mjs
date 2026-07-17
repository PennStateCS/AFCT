// Generates an OpenAPI spec + a Redoc reference page for the app's API routes.
//
// The skeleton (paths, HTTP methods, path params, auth hints, source links) is
// inferred from src/app/api/**/route.ts, so it always matches the code. Any
// endpoint can be enriched by adding an `@openapi` YAML block in the comment
// directly above its handler; that block is deep-merged over the inferred one.
//
// After building, it reports enrichment coverage and exits non-zero if any
// @openapi block is malformed or the emitted spec fails OpenAPI schema validation
// (set DOCS_STRICT=1 to also fail when any operation lacks an @openapi block).
//
// Run: npm run docs:api   →   writes to $DOCS_OUT (default: docs-dist/)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { Validator } from '@seriousme/openapi-schema-validator';

const API_DIR = 'src/app/api';
const OUT_DIR = process.env.DOCS_OUT || 'docs-dist';
const REPO = 'PennStateCS/AFCT';
const BRANCH = 'main';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// NextAuth's catch-all isn't a documentable REST endpoint.
const SKIP = new Set([join(API_DIR, 'auth', '[...nextauth]', 'route.ts')]);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

// Rendered as markdown at the top of the docs: the orientation a new consumer needs.
const API_DESCRIPTION = [
  'Auto-generated reference for the AFCT Dashboard API. Paths and methods are inferred',
  'from the route files so the docs stay in step with the code; individual endpoints are',
  'enriched with an `@openapi` block in the source.',
  '',
  '## Authentication',
  '',
  'The API authenticates with the **NextAuth session cookie**. Most endpoints require a',
  'signed-in session; some additionally require an `ADMIN`, `FACULTY`, or `TA` role — the',
  'requirement is stated on each operation. A few endpoints (health, signup, login, public',
  'settings) need no session.',
  '',
  '## Conventions',
  '',
  '- **Base URL:** same-origin, relative to the deployed app.',
  '- **Errors:** failures return a JSON body with an `error` or `message` string (see the',
  '  `Error` schema).',
  '- **Dates:** `datetime-local` strings (`YYYY-MM-DDTHH:MM`) are interpreted in the',
  "  actor's timezone and stored as UTC.",
  '- Every operation links to its **source** on GitHub.',
].join('\n');

// One-line context per tag (tags are the first path segment). Unlisted tags render bare.
const TAG_DESCRIPTIONS = {
  auth: 'Sign-up and credential/email checks.',
  courses: 'Courses, rosters, enrollment, groups, grades, and their assignments and problems.',
  comments: "An assignment problem's discussion comments.",
  assignments: "An assignment's problem list (global lookup by assignment id).",
  submissions: 'Student submissions and re-evaluation.',
  users: 'User accounts and administration.',
  me: "The signed-in user's own profile, password, courses, enrollments, and assignments.",
  files: 'Served avatars, uploaded files, and solution files.',
  admin: 'Admin-only user, submission, log, and system tools.',
  'system-settings': 'System configuration, TLS certificates, and backups.',
  session: 'Session keep-alive.',
  health: 'Liveness probe for the container healthcheck.',
  public: 'Public credential verification.',
};

// ── Redoc page options ───────────────────────────────────────────────────────
// Flip these to change the rendered docs page (docs-dist/index.html); they're
// passed straight to Redoc.init(). Full reference: https://redocly.com/docs/redoc/config
const REDOC_OPTIONS = {
  disableSearch: false, // true = hide the left-nav search box
  hideDownloadButton: false, // true = hide the "Download" (raw openapi.json) button
  expandResponses: '200,201', // which responses start expanded: 'all' | '200,201' | '' (none)
  jsonSampleExpandLevel: 2, // depth JSON samples auto-expand to: a number, or 'all'
  sortOperationsAlphabetically: false, // sort operations within a tag in the nav
  sortTagsAlphabetically: false, // sort tag groups in the nav (already sorted in the spec)
  onlyRequiredInSamples: false, // true = request samples show only required fields
  hideSchemaTitles: false, // true = hide schema names above object schemas
  hideSingleRequestSampleTab: false, // true = collapse the sample tab when there's only one
  menuToggle: true, // let readers collapse tag groups in the nav
  pathInMiddlePanel: true, // show the request path in the content panel
  requiredPropsFirst: true, // list required properties before optional ones
  sortPropsAlphabetically: true, // sort object properties A–Z
  // Branding: uncomment and set to match the app:
  // theme: { colors: { primary: { main: '#2563eb' } }, sidebar: { width: '280px' } },
};

function findRoutes(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...findRoutes(p));
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

// src/app/api/courses/[id]/route.ts -> /api/courses/{id}
function toApiPath(file) {
  const segs = relative(API_DIR, file)
    .split(sep)
    .slice(0, -1) // drop route.ts
    .filter((s) => !(s.startsWith('(') && s.endsWith(')'))) // route groups aren't in the URL
    .map((s) => s.replace(/^\[\.\.\.(.+?)\]$/, '{$1}').replace(/^\[(.+?)\]$/, '{$1}'));
  return '/api/' + segs.join('/');
}

function stripCommentMarkers(line) {
  return line
    .replace(/^\s*\/\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .replace(/^\s*\*+\/?/, '')
    .replace(/^\s*\/\//, '')
    .replace(/\s+$/, '');
}

// Collect the comment block immediately above line `i`.
function commentAbove(lines, i) {
  let j = i - 1;
  while (j >= 0 && lines[j].trim() === '') j--;
  const block = [];
  if (lines[j] && lines[j].includes('*/')) {
    while (j >= 0) {
      block.unshift(lines[j]);
      if (lines[j].includes('/*')) break;
      j--;
    }
  } else {
    while (j >= 0 && lines[j].trim().startsWith('//')) {
      block.unshift(lines[j]);
      j--;
    }
  }
  return block.map(stripCommentMarkers);
}

// Split a comment block into a plain-text description and an optional @openapi
// YAML operation object. `parseError` is set when an @openapi block is present
// but its YAML is malformed, so the caller can surface it instead of silently
// falling back to the skeleton.
function splitComment(block) {
  const idx = block.findIndex((l) => l.trim().startsWith('@openapi'));
  if (idx === -1) return { description: block.join(' ').trim(), operation: null, parseError: null };
  const description = block.slice(0, idx).join(' ').trim();
  const yamlText = block.slice(idx + 1).join('\n');
  try {
    return { description, operation: loadYaml(yamlText) || null, parseError: null };
  } catch (err) {
    return { description, operation: null, parseError: err.message };
  }
}

function deepMerge(base, extra) {
  if (Array.isArray(extra)) return extra;
  if (extra && typeof extra === 'object') {
    const out = { ...base };
    for (const [k, v] of Object.entries(extra)) {
      out[k] = k in base ? deepMerge(base[k], v) : v;
    }
    return out;
  }
  return extra;
}

function parseRoute(file) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+(${METHODS.join('|')})\\b`);
  const ops = {};
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) ops[m[1]] = splitComment(commentAbove(lines, i));
  }
  const authed = /\bawait\s+auth\(\)/.test(src) || /\bauth\(\)/.test(src);
  const roles = [
    ...new Set(
      [...src.matchAll(/'(ADMIN|FACULTY|TA|STUDENT)'/g)]
        .map((x) => x[1])
        // only treat as required roles if they appear in an includes()/role check
        .filter(() =>
          /\.includes\(\s*role|role\s*(?:===|!==)|requireRole|\[['"](?:ADMIN|FACULTY)/.test(src),
        ),
    ),
  ];
  return { ops, authed, roles };
}

function tagFor(apiPath) {
  const seg = apiPath.split('/')[2] || 'root';
  return seg.replace(/[{}]/g, '');
}

// Stable, unique operationId from method + path, e.g.
// GET /api/courses/{id}/{aid} -> getCoursesByIdByAid. Drives client codegen.
const toPascal = (s) =>
  s
    .replace(/[-_]+/g, ' ')
    .replace(/(?:^|\s)(\w)/g, (_, c) => c.toUpperCase())
    .replace(/\s+/g, '');
function operationId(method, apiPath) {
  const parts = apiPath
    .replace(/^\/api\//, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      const param = seg.match(/^\{(.+)\}$/);
      return toPascal(param ? `by-${param[1]}` : seg);
    });
  return method.toLowerCase() + parts.join('');
}

// Point any error response (>= 400) that doesn't already describe a body at the
// shared Error schema, so every 4xx/5xx documents the same { error | message } shape.
function attachErrorResponses(op) {
  if (!op.responses) return;
  for (const [code, resp] of Object.entries(op.responses)) {
    if (Number(code) >= 400 && resp && typeof resp === 'object' && !resp.$ref && !resp.content) {
      resp.content = { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } };
    }
  }
}

function buildSpec(routes) {
  const paths = {};
  const tags = new Set();
  const stats = { enriched: 0, skeletonOnly: [], parseErrors: [] };

  for (const file of routes.sort()) {
    if (SKIP.has(file)) continue;
    const apiPath = toApiPath(file);
    const { ops, authed, roles } = parseRoute(file);
    if (Object.keys(ops).length === 0) continue;

    const params = [...apiPath.matchAll(/\{([^}]+)\}/g)].map((mm) => ({
      name: mm[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const source = `https://github.com/${REPO}/blob/${BRANCH}/${file.replace(/\\/g, '/')}`;
    const tag = tagFor(apiPath);
    tags.add(tag);

    paths[apiPath] ||= {};
    for (const [method, { description, operation, parseError }] of Object.entries(ops)) {
      if (parseError) {
        stats.parseErrors.push({ apiPath, method, message: parseError });
      } else if (operation) {
        stats.enriched += 1;
      } else {
        stats.skeletonOnly.push(`${method} ${apiPath}`);
      }
      const authNote = authed
        ? roles.length
          ? `**Auth:** requires ${roles.join(' / ')}`
          : '**Auth:** required'
        : '';
      const skeleton = {
        tags: [tag],
        operationId: operationId(method, apiPath),
        summary: description || `${method} ${apiPath}`,
        description: [description, authNote].filter(Boolean).join('\n\n'),
        // Machine-readable auth: an authenticated route needs the session cookie;
        // a public one advertises no requirement. An @openapi block can override.
        security: authed ? [{ cookieAuth: [] }] : [],
        ...(params.length ? { parameters: params } : {}),
        // Only fall back to a placeholder response when the @openapi block doesn't
        // declare its own; otherwise the placeholder lingers alongside real ones.
        ...(operation?.responses ? {} : { responses: { 200: { description: 'Success' } } }),
      };
      const op = operation ? deepMerge(skeleton, operation) : skeleton;
      // Always append the source link, even when @openapi overrides the description.
      op.description = [op.description, `[View source](${source})`].filter(Boolean).join('\n\n');
      attachErrorResponses(op);
      paths[apiPath][method.toLowerCase()] = op;
    }
  }

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'AFCT Dashboard API',
      version: pkg.version || '0.0.0',
      description: API_DESCRIPTION,
    },
    servers: [{ url: '/', description: 'Same-origin (relative to the deployed app)' }],
    tags: [...tags]
      .sort()
      .map((name) =>
        TAG_DESCRIPTIONS[name] ? { name, description: TAG_DESCRIPTIONS[name] } : { name },
      ),
    paths,
    components: {
      securitySchemes: {
        // NextAuth stores the session in a cookie; the Secure-prefixed variant is
        // used over HTTPS. Operations that require a session reference this scheme.
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'next-auth.session-token',
          description:
            'NextAuth session cookie (`__Secure-next-auth.session-token` over HTTPS). ' +
            'Role requirements, where they apply, are noted in each operation description.',
        },
      },
      schemas: {
        // Shared error body. Handlers return one of these string fields; error
        // responses (4xx/5xx) reference this schema.
        Error: {
          type: 'object',
          description:
            'Error response. Handlers return `error` or `message` with a human-readable reason.',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  };
  return { spec, stats };
}

// Redoc renders openapi.json as a static, read-only reference (three-panel layout,
// left-nav search, a spec-download button). It fetches openapi.json from the same
// directory, so it works as-is on GitHub Pages.
const REDOC_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AFCT Dashboard API</title>
  <style>body { margin: 0; padding: 0 }</style>
</head>
<body>
  <div id="redoc"></div>
  <script src="https://unpkg.com/redoc@2/bundles/redoc.standalone.js"></script>
  <script>
    Redoc.init(
      'openapi.json',
      ${JSON.stringify(REDOC_OPTIONS, null, 6)},
      document.getElementById('redoc'),
    );
  </script>
</body>
</html>
`;

const routes = findRoutes(API_DIR);
const { spec, stats } = buildSpec(routes);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'openapi.json'), JSON.stringify(spec, null, 2));
writeFileSync(join(OUT_DIR, 'index.html'), REDOC_HTML);

const endpointCount = Object.values(spec.paths).reduce((n, o) => n + Object.keys(o).length, 0);
console.log(
  `[docs] wrote ${OUT_DIR}/openapi.json (${Object.keys(spec.paths).length} paths, ` +
    `${endpointCount} operations) + index.html`,
);

// Coverage: how many operations carry a hand-written @openapi block vs. rely on
// the inferred skeleton alone.
const skeletonCount = stats.skeletonOnly.length;
console.log(
  `[docs] enrichment: ${stats.enriched}/${endpointCount} operations have an @openapi block` +
    (skeletonCount ? ` (${skeletonCount} inferred-only)` : ''),
);
if (skeletonCount) {
  console.log('[docs] inferred-only operations:');
  for (const op of stats.skeletonOnly) console.log(`         - ${op}`);
}

// A malformed @openapi block silently degrades to the skeleton, so treat it as a
// hard error: the block was meant to say something and isn't.
if (stats.parseErrors.length) {
  console.error(`\n[docs] ERROR: ${stats.parseErrors.length} malformed @openapi block(s):`);
  for (const e of stats.parseErrors) {
    console.error(`         - ${e.method} ${e.apiPath}: ${e.message.split('\n')[0]}`);
  }
  process.exit(1);
}

// operationIds must be unique for client codegen; the schema check doesn't enforce it.
const seenOpIds = new Map();
for (const [p, methods] of Object.entries(spec.paths)) {
  for (const [m, op] of Object.entries(methods)) {
    if (!op.operationId) continue;
    if (seenOpIds.has(op.operationId)) {
      console.error(
        `\n[docs] ERROR: duplicate operationId "${op.operationId}" ` +
          `(${m} ${p} and ${seenOpIds.get(op.operationId)})`,
      );
      process.exit(1);
    }
    seenOpIds.set(op.operationId, `${m} ${p}`);
  }
}

// Structural validation against the OpenAPI 3.x schema, so a bad deep-merge or a
// syntactically-valid-but-wrong block can't slip a broken spec into the docs.
const { valid, errors } = await new Validator().validate(spec);
if (!valid) {
  console.error('\n[docs] ERROR: generated spec is not a valid OpenAPI document:');
  console.error(typeof errors === 'string' ? errors : JSON.stringify(errors, null, 2));
  process.exit(1);
}
console.log('[docs] spec validates against the OpenAPI schema');

// Opt-in gate (DOCS_STRICT=1): also fail when any operation is still skeleton-only,
// so a team can enforce full enrichment once they've reached it.
if (process.env.DOCS_STRICT === '1' && skeletonCount) {
  console.error(
    `\n[docs] ERROR: DOCS_STRICT set and ${skeletonCount} operation(s) lack an @openapi block.`,
  );
  process.exit(1);
}
