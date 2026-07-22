# Code comment style

**Audience:** engineers working on AFCT

Comments in AFCT exist to explain what the code cannot say for itself. A reader can see *what* a line does; a comment should tell them *why* it is written that way. Follow these conventions so comments stay useful and do not rot.

## Explain why, not what

Do not restate the code. Comment the reasoning, the constraint, or the consequence that is not visible from the code alone.

```ts
// Avoid: restates the code
// Increment the attempts counter
submission.attempts += 1;

// Prefer: explains the reason
// Bump attempts at claim time, before evaluation, so a submission that keeps
// crashing the evaluator is eventually failed by the poison-pill guard.
submission.attempts += 1;
```

Good reasons to leave a comment:

- A security or correctness invariant that must hold ("derive the course from the assignment, never from the request body").
- A non-obvious constraint from an external system ("bcrypt ignores bytes past 72, so cap the password there").
- A deliberate edge-case decision ("an empty `notIn` is a Prisma footgun, so only add the filter when the list is non-empty").
- Why the obvious simpler approach was not taken.

## Keep comments next to what they describe

Put the comment immediately above the code it explains, not in a distant block. A comment that has drifted away from its code is worse than none, because the reader trusts it.

When you change code, update or delete the comment above it in the same edit. An out-of-date comment is a bug.

## Write for correctness and security first

Call out the things that will cause a real problem if a future editor gets them wrong: race conditions, authorization boundaries, timezone handling, resource limits, and ordering requirements. These are the comments most worth reading and most worth keeping accurate.

```ts
// The `status: 'PENDING'` guard IS the claim: Postgres evaluates it under row
// lock, so of two workers racing the same row exactly one wins. There is no
// select-then-update window to lose.
```

## Match the surrounding style

New code should read like the code around it. Match the existing comment density and voice of the file you are editing rather than introducing a different style.

- Use complete sentences with normal capitalization and punctuation.
- Do not use em dashes. Use a comma, parentheses, or a separate sentence instead. (This matches the [Documentation style](./documentation-style.md) rule and is enforced by convention across the codebase.)
- Keep it concise. One or two sentences usually carries the reasoning; move a long explanation into the relevant reference page and link to it.

## Document exported helpers with JSDoc

For shared functions, especially in `src/lib/`, a short JSDoc block that states the contract (what it guarantees, what it assumes the caller has already checked, and what it returns) is worth more than inline comments at each call site.

```ts
/**
 * A student's view of a course's published assignments with their problems and this
 * student's own grade and status. The caller MUST have already gated course access.
 * Never includes the answer-key file.
 */
export async function getStudentCourseAssignments(/* ... */) {}
```

State preconditions the type system cannot express, such as "the caller must have already gated course access." That sentence prevents a real security mistake.

## Do not comment out code

Delete dead code instead of commenting it out. Version control remembers it. A block of commented-out code leaves the next reader guessing whether it is a note, a rollback plan, or an accident.

`TODO` comments are acceptable when they are specific and actionable. Prefer linking a tracked issue over an open-ended `TODO` that no one will find again.

## Comments are not a substitute for clear code

If a line needs a comment to be understood, first consider whether a better name or a small helper would remove the need. Reserve comments for the reasoning that clearer code still cannot express.
