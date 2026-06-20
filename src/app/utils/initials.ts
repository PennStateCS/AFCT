// Generates a users initials
export function getInitials(firstName: string | null | undefined, lastName: string | null | undefined, email: string | undefined): string {
  if (!firstName && !lastName) return 'U';
  const first = firstName?.charAt(0) || '';
  const last = lastName?.charAt(0) || '';
  return first + last || email?.charAt(0).toUpperCase() || 'U';
};