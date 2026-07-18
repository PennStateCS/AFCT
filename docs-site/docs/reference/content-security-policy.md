# Content Security Policy

AFCT sends a strict, nonce-based [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) (CSP) on every page. A CSP tells the browser which sources of scripts, styles, frames, and connections are allowed, which limits the damage a cross-site scripting (XSS) bug could do: even if malicious markup were injected, the browser refuses to execute a script that the policy does not permit.

## How it works

The policy is generated per request in the application middleware (`src/proxy.ts`). Each response gets a fresh random **nonce**, and the app's own `<script>` tags are stamped with that nonce automatically. The script policy is:

```
script-src 'self' 'nonce-<random>' 'strict-dynamic' https://hcaptcha.com https://*.hcaptcha.com
```

- **`'nonce-<random>'`** allows only the scripts the app itself emitted this request. An injected inline script has no valid nonce, so it is blocked.
- **`'strict-dynamic'`** lets a trusted (nonce'd) script load additional scripts, which is how the application bundle loads its code chunks and how the hCaptcha widget loads its script.
- There is deliberately **no `'unsafe-inline'`** for scripts.

Other notable directives: `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`, and scoped `connect-src` / `frame-src` / `img-src` / `font-src`. Styles keep `'unsafe-inline'` (`style-src 'self' 'unsafe-inline' …`) because the interface uses inline styles; style-based injection is low-risk.

The hCaptcha origins are allowlisted in the script, frame, style, and connect directives so the bot-protection challenge works under the policy.

`frame-ancestors 'self'` is additionally enforced by nginx (`docker/nginx/default.conf`) so that directly-served files under `/uploads/` are also protected against clickjacking.

## Enforcement

The policy runs in one of two modes:

| Mode | Header | Behavior |
| --- | --- | --- |
| **Enforced** | `Content-Security-Policy` | The browser **blocks** anything the policy disallows. |
| **Report-Only** | `Content-Security-Policy-Report-Only` | The browser **reports** violations to the console but blocks nothing. |

- **Production enforces the policy by default.**
- **Development stays Report-Only**, so Next.js hot-reload and the error overlay are never blocked while you work.

### The `CSP_ENFORCE` setting

Set this in `.env.production` to override the default:

| Value | Effect |
| --- | --- |
| unset (default) | Enforced in production, Report-Only in development |
| `CSP_ENFORCE="false"` | Report-Only everywhere (use to debug a violation without breaking the site) |
| `CSP_ENFORCE="true"` | Enforced everywhere, including development |

## Troubleshooting a blocked resource

If part of the site stops working after a change and you suspect the CSP:

1. Open the browser developer tools and look in the console for a message like
   `Refused to load … because it violates the following Content Security Policy directive`.
   The message names the exact resource and the directive that blocked it.
2. To confirm the CSP is the cause without breaking the site for users, set
   `CSP_ENFORCE="false"` in `.env.production` and restart the application
   (`sh install.sh restart`). The same violations now appear as reports rather than
   blocks. If the problem disappears, the CSP was the cause.
3. Add the required source to the appropriate directive in `buildCsp` (`src/proxy.ts`),
   or nonce the script, then re-enable enforcement.

Prefer nonces or specific hosts over loosening the policy (for example, avoid adding `'unsafe-inline'` or `'unsafe-eval'` to `script-src`), so the protection stays meaningful.
