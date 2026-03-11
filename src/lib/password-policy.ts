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
  passwordRules.every((rule) => rule.test(password));
