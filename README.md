# AFCT Dashboard

A modern Next.js 16 dashboard for the Automated Feedback for CS Theory (AFCT) system.  
Built with:

![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwindcss&logoColor=white)
![Auth.js](https://img.shields.io/badge/Auth.js-NextAuth%20v5-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)
[![CI](https://github.com/PennStateWilkes-Barre/AFCT-Dashboard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/PennStateWilkes-Barre/AFCT-Dashboard/actions/workflows/ci.yml)
[![Publish Docker image to GHCR](https://github.com/PennStateWilkes-Barre/AFCT-Dashboard/actions/workflows/publish-ghcr.yml/badge.svg?branch=main)](https://github.com/PennStateWilkes-Barre/AFCT-Dashboard/actions/workflows/publish-ghcr.yml)

## Tech Stack

- Node.js 22+
- Next.js 16 + React 19
- PostgreSQL 15 + Prisma 7
- Auth.js / NextAuth v5
- Tailwind CSS 4
- TypeScript 5.9
- Docker + GHCR

## Funding Acknowledgement

This project is supported in part by the National Science Foundation under Grant No. 2439326. Any opinions, findings, conclusions, or recommendations expressed are those of the authors and do not necessarily reflect the views of the NSF.

## Participating Institutions

AFCT is part of a multi-institutional collaboration involving:

- College of the Holy Cross
- Rochester Institute of Technology
- The Pennsylvania State University
- The University of New Mexico
- University of Rochester

This collaboration supports the continued development, deployment, and study of AFCT across undergraduate computing theory courses.

## Documentation

The AFCT Dashboard includes automatically generated documentation for the HTTP API. The API reference is rebuilt from the route handlers and published whenever changes are pushed to `main`.

- **[API Reference](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/)** — browsable documentation for each endpoint, including authentication requirements, parameters, and request/response formats.
- **[OpenAPI Specification](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/openapi.json)** — the raw `openapi.json` file, which can be imported into tools such as Postman, Insomnia, or client-generation workflows.

User guides, written by audience, live under [`docs/guides`](docs/guides/README.md):

- **[Administrator guide](docs/guides/admin.md)** — accounts, signup control, the course lifecycle, system settings, the submission queue, status, audit, backups, and security.
- **[Faculty and TA guide](docs/guides/faculty.md)** — running a course, assignments and problems, roster and enrollment, grading and feedback, and groups.
- **[Student guide](docs/guides/student.md)** — joining a course, finding and submitting work, feedback and grades, groups, profile, and sign-in.
- **[Developer guide](docs/guides/developer.md)** — stack, repository layout, the authorization model, API and data conventions, logging, time handling, testing, and CI/CD.
- **[Roles and permissions](docs/role-inheritance.md)** — the precise reference for who can do what, shared by all four guides.

Additional setup and deployment guides are available in the repository:

- **[Development Setup](docs/development_setup.md)** — instructions for configuring a local development environment.
- **[Production Setup](docs/production_setup.md)** — instructions for deploying the GHCR image with Docker Compose and an Nginx reverse proxy.

## Contributors

| Name                | Affiliation | Email            | GitHub                                        |
| ------------------- | ----------- | ---------------- | --------------------------------------------- |
| Jesse Burdick-Pless | RIT         | -                | [jb4411](https://github.com/jb4411)           |
| Jeffrey Chiampi     | PSU         | jdc308@psu.edu   | [jdc308](https://github.com/jdc308)           |
| Edwin Kismal        | PSU         | etk5176@psu.edu  | [EdwinKimsal](https://github.com/EdwinKimsal) |
| Adam Manowski       | PSU         | ajm9738@psu.edu  | [astermaxed](https://github.com/astermaxed)   |
| Andrew Sutton       | PSU         | ams12165@psu.edu | [asutton24](https://github.com/asutton24)     |
