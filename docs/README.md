```markdown
# AFCT Dashboard Documentation

The AFCT documentation is organized around three common goals:

1. **Using the application**
2. **Understanding the system**
3. **Running an AFCT server**

Start with the section that best matches what you are trying to do.

## Use the application

These guides explain how to use AFCT based on your role. Read your guide once to become familiar with the main workflows, then return to it whenever you need instructions for a specific task.

- [Administrator guide](guides/admin.md)  
  Manage user accounts, signup settings, courses, system settings, the submission queue, system status, audit records, and backups.

- [Faculty and TA guide](guides/faculty.md)  
  Manage courses, assignments, problems, rosters, groups, grading, and student feedback.

- [Student guide](guides/student.md)  
  Join a course, submit work, and review grades and feedback.

## Understand the system

These pages provide technical reference material for developers and system maintainers. They are designed to be consulted as needed rather than read from beginning to end.

- [Developer guide](guides/developer.md)  
  Learn about the technology stack, repository structure, authorization model, API and data conventions, logging, date and time handling, testing, and CI/CD workflows.

- [Roles and permissions](reference/roles-and-permissions.md)  
  Review the authoritative definition of AFCT access control, including the global `isAdmin` flag, course-level roles, and the complete resource permission matrix. All other guides defer to this page when describing who can perform an action.

- [Client API](reference/client-api.md)  
  Review the token-authenticated `/api/client/v1` API used by the native AFCT submission client.

### HTTP API reference

The interactive HTTP API documentation is generated directly from the application’s route handlers and published through [GitHub Pages](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/).

The raw [OpenAPI specification](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/openapi.json) can be imported into tools such as Postman or Insomnia, or used with an OpenAPI client generator.

## Run an AFCT server

- [Development setup](setup/development.md)  
  Configure the Docker development environment, review exposed ports and common commands, and troubleshoot common setup problems.

- [Production setup](setup/production.md)  
  Deploy the AFCT container image from GitHub Container Registry behind nginx with TLS enabled.

## Keep the documentation accurate

The AFCT documentation should change whenever the application changes. When a feature is added or modified, update the corresponding documentation in the same commit. This helps prevent the documentation from drifting away from the actual behavior of the system.

Access-control rules have one authoritative location: [Roles and permissions](reference/roles-and-permissions.md). Other pages should link to that reference rather than repeat permission rules that may later change.
```
