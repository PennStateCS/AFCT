# AFCT Dashboard documentation

End-user documentation (guides, installation, operations, reference) lives in the
Docusaurus site under [`docs-site/`](../docs-site/) and is published at
<https://pennstatewilkes-barre.github.io/AFCT-Dashboard/>. The generated HTTP API
reference is published on the same site under
[/api-reference/](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/api-reference/afct-dashboard-api);
the [OpenAPI specification](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/api/openapi.json)
can be imported into Postman, Insomnia, and OpenAPI client generators.

To edit the published docs, edit the Markdown under
[`docs-site/docs/`](../docs-site/docs/) (see
[Documentation style](contributing/documentation.md)); the site deploys
automatically on merge to main.

## Contributor docs (this folder)

| Guide | Use it for |
|---|---|
| [Developer guide](guides/developer.md) | Architecture, authorization, API conventions, validation, data access, logging, and CI |
| [Development setup](setup/development.md) | Local Docker setup, common commands, database work, and development troubleshooting |
| [Logging policy](logging-policy.md) | What gets audit-logged and at which severity |
| [Route authorization](route-authorization.md) | Per-route access rules |
| [Roadmap](roadmap.md) | Planned work |

## Documentation rules

Access-control rules have one authoritative home:
[Roles and permissions](../docs-site/docs/reference/roles-and-permissions.md).
Other guides should link to that page instead of repeating the full permission
matrix.

Update the relevant documentation in the same pull request as a feature or
behavior change. For writing and organization conventions, see
[Documentation style](contributing/documentation.md).
