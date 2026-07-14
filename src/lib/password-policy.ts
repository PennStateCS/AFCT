// bcrypt hashes only the first 72 bytes of a password, so anything longer is
// silently truncated. Cap password length everywhere it's set to avoid that
// surprise. This is the single source of truth for the length ceiling.
export const PASSWORD_MAX_LENGTH = 72;

// The single source of truth for password-strength requirements. Consumed by the
// live checklist UI, the `isStrongPassword` predicate, and the Zod `StrongPassword`
// schema, so all three stay in lockstep.
export const passwordRules = [
  { label: 'At least 8 characters', test: (pw: string) => pw.length >= 8 },
  { label: 'At least one uppercase letter', test: (pw: string) => /[A-Z]/.test(pw) },
  { label: 'At least one lowercase letter', test: (pw: string) => /[a-z]/.test(pw) },
  { label: 'At least one number', test: (pw: string) => /\d/.test(pw) },
  { label: 'At least one special character', test: (pw: string) => /[^A-Za-z0-9]/.test(pw) },
] as const;

export const passwordRequirementText =
  'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.';

export const isStrongPassword = (password: string) =>
  password.length <= PASSWORD_MAX_LENGTH && passwordRules.every((rule) => rule.test(password));
