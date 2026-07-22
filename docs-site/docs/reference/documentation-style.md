# Documentation style

Use this guide when adding or updating AFCT documentation.

## Write for the reader's task

Start with what the reader is trying to accomplish. Put prerequisites before steps, and put troubleshooting near the task that can fail.

Use headings that describe actions or decisions. Prefer `Create a course` over `Course creation functionality`.

## Keep the voice natural

Write in plain, professional language. Contractions are fine when they make a sentence sound more natural.

Avoid:

- Em dashes
- Marketing language
- Jokes that distract from the instructions
- Long paragraphs that combine several ideas
- Repeating the same policy in several guides
- Describing obvious interface controls without explaining their effect

## Use consistent terms

Use the interface label when one exists, and format it in bold. Use code formatting for route names, environment variables, filenames, commands, and database fields.

Use these role names consistently:

- Administrator
- Faculty
- TA
- Student
- Course staff, when referring to Faculty and TAs together

## Put authoritative information in one place

The complete authorization model belongs in [Roles and permissions](./roles-and-permissions.md). Role guides may summarize the rules that matter to their audience, but they should link to the reference page for the complete model.

The generated OpenAPI documentation is the detailed reference for browser API routes. The handwritten [Client API](./client-api.md) page covers the stable native-client contract.

## Check links and examples

Before submitting documentation changes:

1. Confirm every relative link resolves.
2. Confirm commands are run from the directory named in the instructions.
3. Confirm examples do not contain real passwords, tokens, private keys, or institutional data.
4. Confirm code fences open and close correctly.
5. Search for outdated product names, role names, and version numbers.
