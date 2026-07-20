import { cn } from '@/lib/utils';
import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'destructive' | 'outline';
  /**
   * Which course/system role this badge shows. Named `userRole`, not `role`, so it does
   * not shadow the DOM `role` attribute inherited from HTMLAttributes (that collision
   * both blocked setting a real ARIA role and read as an invalid one to auditors).
   */
  userRole?: 'ADMIN' | 'FACULTY' | 'TA' | 'STUDENT';
}

const roleStyles: Record<string, string> = {
  ADMIN: 'bg-red-800 text-white',
  FACULTY: 'bg-blue-800 text-white',
  TA: 'bg-slate-800 text-white',
  STUDENT: 'bg-green-800 text-white',
};

const badgeVariants: Record<string, string> = {
  default: 'bg-primary text-white',
  destructive: 'bg-red-600 text-white',
  outline: 'border border-gray-300 text-gray-700',
};

// Helper to normalize role input to match roleStyles keys
function normalizeRole(role?: string): keyof typeof roleStyles | undefined {
  if (!role) return undefined;
  const upper = role.toUpperCase();
  return upper in roleStyles ? (upper as keyof typeof roleStyles) : undefined;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', userRole, children, ...props }, ref) => {
    const normalizedRole = normalizeRole(userRole);
    const variantClass = normalizedRole ? roleStyles[normalizedRole] : badgeVariants[variant];
    const defaultLabel =
      normalizedRole === 'TA'
        ? 'TA'
        : normalizedRole
          ? normalizedRole.charAt(0) + normalizedRole.slice(1).toLowerCase()
          : '';

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-full px-4 py-0.5 text-sm',
          variantClass,
          className,
        )}
        {...props}
      >
        {children ?? defaultLabel}
      </span>
    );
  },
);

Badge.displayName = 'Badge';
