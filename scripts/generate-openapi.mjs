// Generates an OpenAPI spec + a Swagger UI page for the app's API routes.
//
// The skeleton (paths, HTTP methods, path params, auth hints, source links) is
// inferred from src/app/api/**/route.ts, so it always matches the code. Any
// endpoint can be enriched by adding an `@openapi` YAML block in the comment
// directly above its handler; that block is deep-merged over the inferred one.
//
// Run: npm run docs:api   →   writes to $DOCS_OUT (default: docs-dist/)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { load as loadYaml } from 'js-yaml';

const API_DIR = 'src/app/api';
const OUT_DIR = process.env.DOCS_OUT || 'docs-dist';
const REPO = 'pennstatewilkes-barre/afct-dashboard';
const BRANCH = 'main';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// NextAuth's catch-all isn't a documentable REST endpoint.
const SKIP = new Set([join(API_DIR, 'auth', '[...nextauth]', 'route.ts')]);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

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
// YAML operation object.
function splitComment(block) {
  const idx = block.findIndex((l) => l.trim().startsWith('@openapi'));
  if (idx === -1) return { description: block.join(' ').trim(), operation: null };
  const description = block.slice(0, idx).join(' ').trim();
  const yamlText = block.slice(idx + 1).join('\n');
  let operation = null;
  try {
    operation = loadYaml(yamlText) || null;
  } catch {
    // malformed @openapi block — fall back to the skeleton
  }
  return { description, operation };
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
        .filter(() => /\.includes\(\s*role|role\s*(?:===|!==)|requireRole|\[['"](?:ADMIN|FACULTY)/.test(src)),
    ),
  ];
  return { ops, authed, roles };
}

function tagFor(apiPath) {
  const seg = apiPath.split('/')[2] || 'root';
  return seg.replace(/[{}]/g, '');
}

function buildSpec(routes) {
  const paths = {};
  const tags = new Set();

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
    for (const [method, { description, operation }] of Object.entries(ops)) {
      const notes = [];
      if (authed) {
        notes.push(roles.length ? `**Auth:** requires ${roles.join(' / ')}` : '**Auth:** required');
      }
      notes.push(`[View source](${source})`);

      const skeleton = {
        tags: [tag],
        summary: description || `${method} ${apiPath}`,
        description: [description, notes.join(' · ')].filter(Boolean).join('\n\n'),
        ...(params.length ? { parameters: params } : {}),
        responses: { 200: { description: 'Success' } },
      };
      paths[apiPath][method.toLowerCase()] = operation
        ? deepMerge(skeleton, operation)
        : skeleton;
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'AFCT Dashboard API',
      version: pkg.version || '0.0.0',
      description:
        'Auto-generated reference for the app\'s API routes. Paths and methods are ' +
        'inferred from the route files; individual endpoints can be enriched with an ' +
        '`@openapi` block in the code.',
    },
    servers: [{ url: '/', description: 'Same-origin (relative to the deployed app)' }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
  };
}

const SWAGGER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AFCT Dashboard API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0 }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: 'openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      // Read-only reference: "Try it out" can't reach a private deployment cross-origin.
      supportedSubmitMethods: [],
      docExpansion: 'none',
    });
  </script>
</body>
</html>
`;

const routes = findRoutes(API_DIR);
const spec = buildSpec(routes);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'openapi.json'), JSON.stringify(spec, null, 2));
writeFileSync(join(OUT_DIR, 'index.html'), SWAGGER_HTML);

const endpointCount = Object.values(spec.paths).reduce((n, o) => n + Object.keys(o).length, 0);
console.log(
  `[docs] wrote ${OUT_DIR}/openapi.json (${Object.keys(spec.paths).length} paths, ` +
    `${endpointCount} operations) + index.html`,
);
