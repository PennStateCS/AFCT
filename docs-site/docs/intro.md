---
slug: /
---

# AFCT Dashboard

AFCT (Automated Feedback for CS Theory) is a course dashboard for automata and formal-language coursework. Students submit finite automata, push-down automata, context-free grammars, regular expressions, and Turing machines built in JFLAP. AFCT grades them automatically and answers straight away, while faculty run their courses, assignments, and grades in the same place.

## Where to start

**New here?** [Your first course](getting-started/first-course.md) walks the whole path once, from
a fresh install to a student submission that comes back graded. About half an hour.

- **Students**: the [Student Guide](student/overview.md) covers enrolling in a course, submitting solutions, and reading your feedback and grades.
- **Faculty and TAs**: the [Faculty Guide](faculty/course.md) covers building courses and assignments, grading, and managing your roster.
- **Administrators**: the [Administrator Guide](guides/admin.md) covers user management, system settings, backups, and updates.

## Running your own AFCT

AFCT is self-hosted with Docker. Start with the [production setup overview](setup/production.md), then follow the guide that matches where you will host it:

- [AWS EC2](setup/production/aws.md), recommended for a public production deployment
- [Linux](setup/production/linux.md), recommended for any long-running server
- [Windows](setup/production/windows.md), useful for smaller or locally managed deployments
- [macOS](setup/production/macos.md), useful for smaller or locally managed deployments

Once deployed, see [updates](operations/updates.md), [backups](operations/backups.md), [TLS certificates](admin/system-settings.md#tls-certificate), and [troubleshooting](operations/troubleshooting.md).

## Before you adopt it

[What AFCT stores about students](getting-started/student-data.md) describes what is kept, where,
and who can read it. It is written to be handed to a privacy or IT office.

## Integrating with AFCT

The HTTP API is documented in the [API Reference](https://pennstatecs.github.io/AFCT/api-reference/afct-dashboard-api), generated from the code on every release. The native submission client uses the token-authenticated [client API](reference/client-api.md).
