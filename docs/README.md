# AFCT Dashboard documentation

AFCT documentation is organized by task. Start with the section that matches what you are trying to do.

## Use AFCT

| Guide | Use it for |
|---|---|
| [Administrator guide](guides/admin.md) | Accounts, signup, course lifecycle, system settings, status, audit records, and backups |
| [Faculty and TA guide](guides/faculty.md) | Course setup, assignments, problems, rosters, grading, comments, and groups |
| [Student guide](guides/student.md) | Joining a course, submitting work, and reviewing grades and feedback |

## Develop AFCT

| Guide | Use it for |
|---|---|
| [Developer guide](guides/developer.md) | Architecture, authorization, API conventions, validation, data access, logging, and CI |
| [Development setup](setup/development.md) | Local Docker setup, common commands, database work, and development troubleshooting |
| [Roles and permissions](reference/roles-and-permissions.md) | The authoritative access-control model |
| [Client API](reference/client-api.md) | The token-authenticated API used by the native submission client |

The generated HTTP API reference is published through [GitHub Pages](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/). The [OpenAPI specification](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/openapi.json) can be imported into Postman, Insomnia, and OpenAPI client generators.

## Deploy and operate AFCT

1. Start with the [production deployment overview](setup/production.md).
2. Follow the guide for the host operating system:
   - [Linux](setup/production/linux.md)
   - [Windows](setup/production/windows.md)
   - [macOS](setup/production/macos.md)
3. Use the operations guides after installation:
   - [TLS and HTTPS](operations/tls.md)
   - [Updates](operations/updates.md)
   - [Backups and recovery](operations/backups.md)
   - [Troubleshooting](operations/troubleshooting.md)
   - [Deployment architecture](reference/deployment-architecture.md)

## Documentation rules

Access-control rules have one authoritative home: [Roles and permissions](reference/roles-and-permissions.md). Other guides should link to that page instead of repeating the full permission matrix.

Update the relevant documentation in the same pull request as a feature or behavior change. For writing and organization conventions, see [Documentation style](contributing/documentation.md).
