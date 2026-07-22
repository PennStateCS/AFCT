# AFCT Dashboard documentation

End-user documentation (guides, installation, operations, reference) lives in the
Docusaurus site under [`docs-site/`](../docs-site/) and is published at
<https://pennstatecs.github.io/AFCT/>. The generated HTTP API
reference is published on the same site under
[/api-reference/](https://pennstatecs.github.io/AFCT/api-reference/afct-dashboard-api);
the [OpenAPI specification](https://pennstatecs.github.io/AFCT/api/openapi.json)
can be imported into Postman, Insomnia, and OpenAPI client generators.

To edit the published docs, edit the Markdown under
[`docs-site/docs/`](../docs-site/docs/) (see
[Documentation style](../docs-site/docs/reference/documentation-style.md)); the site
deploys automatically on merge to main.

## Contributor docs

The developer-facing guides (engineering conventions, code comment style,
documentation style, and development troubleshooting) live in the published site under
**Developer Guide**. Local setup remains in this folder.

| Guide | Use it for |
|---|---|
| [Development setup](setup/development.md) | Local Docker setup, common commands, and database work |
| [Engineering conventions](../docs-site/docs/reference/conventions.md) | Architecture, authorization, API conventions, validation, data access, logging, and CI |

## Documentation rules

Access-control rules have one authoritative home:
[Roles and permissions](../docs-site/docs/reference/roles-and-permissions.md).
Other guides should link to that page instead of repeating the full permission
matrix.

Update the relevant documentation in the same pull request as a feature or
behavior change. For writing and organization conventions, see
[Documentation style](../docs-site/docs/reference/documentation-style.md).
