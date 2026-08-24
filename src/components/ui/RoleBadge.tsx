import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { ROLE_BADGE, ROLE_LABEL } from '@/lib/badge-presets';

export type UserRole = keyof typeof ROLE_BADGE;

export interface RoleBadgeProps extends React.ComponentProps<'span'> {
  /**
   * Which course or system role this badge shows. Named `userRole`, not `role`, so it does
   * not shadow the DOM `role` attribute inherited from the span props (that collision both
   * blocked setting a real ARIA role and read as an invalid one to auditors).
   */
  userRole?: string;
}

/** Accepts whatever casing the caller has to hand; roles arrive from several shapes. */
function normalizeRole(role?: string): UserRole | undefined {
  if (!role) return undefined;
  const upper = role.toUpperCase();
  return upper in ROLE_BADGE ? (upper as UserRole) : undefined;
}

/**
 * A role, in its categorical hue.
 *
 * A thin wrapper over the shared Badge rather than a second badge implementation. It used to
 * draw its own `rounded-full px-4` pill in solid red, blue, slate and green, which was two
 * problems at once: a shape nothing else in the app used, and semantic colours on something
 * that is not a state. Red for Admin and green for Student made a roster read as a list of
 * failures and successes.
 *
 * An unrecognised role falls back to the plain outline treatment rather than disappearing.
 */
export function RoleBadge({ className, userRole, children, ...props }: RoleBadgeProps) {
  const role = normalizeRole(userRole);

  return (
    <Badge variant={role ? ROLE_BADGE[role] : 'outline'} className={className} {...props}>
      {children ?? (role ? ROLE_LABEL[role] : (userRole ?? ''))}
    </Badge>
  );
}

export default RoleBadge;
