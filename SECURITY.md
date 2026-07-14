# Security Policy

## Reporting a vulnerability

Please report security issues **privately**; do not open a public issue for a
suspected vulnerability.

- Preferred: use GitHub's **[Report a vulnerability](https://github.com/PennStateWilkes-Barre/AFCT-Dashboard/security/advisories/new)**
  (Security → Advisories) to open a private advisory.
- Or email the maintainer at **jdc308@psu.edu** with the details and, if possible,
  steps to reproduce.

We aim to acknowledge a report within a few business days. Please give us a
reasonable window to investigate and release a fix before any public disclosure.

## Supported versions

This project ships as a rolling release from the `main` branch and the published
`:main` container image. Fixes land on `main`; there is no separate long-term
support branch. Run the latest image to stay current.

## Deployment hardening

Operators are responsible for a few environment-side settings the application
cannot enforce on its own:

- Set a strong, unique `NEXTAUTH_SECRET` (at least 32 characters; the app refuses
  to start without one) and a strong `ADMIN_PASSWORD` for the initial admin. The
  guided installer generates and prompts for these.
- Terminate TLS with a real certificate (installed in **Admin → System Settings**);
  the self-signed default is only a first-boot placeholder.
- Keep the database and its backups on storage only the operator can reach.
