import { cn } from '@/lib/utils';
import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'destructive' | 'outline';
  role?: 'ADMIN' | 'FACULTY' | 'TA' | 'STUDENT';
}

const roleStyles: Record<string, string> = {
  ADMIN: 'bg-red-600 text-white',
  FACULTY: 'bg-blue-600 text-white',
  TA: 'bg-yellow-400 text-black',
  STUDENT: 'bg-green-600 text-white',
};

const badgeVariants: Record<string, string> = {
  default: 'bg-primary text-white',
  destructive: 'bg-red-600 text-white',
  outline: 'border border-gray-300 text-gray-700',
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', role, children, ...props }, ref) => {
    const variantClass = role ? roleStyles[role] : badgeVariants[variant];

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex w-20 items-center justify-center rounded-full px-2 py-0.5 text-sm font-semibold',
          variantClass,
          className,
        )}
        {...props}
      >
        {children ?? role}
      </span>
    );
  },
);

Badge.displayName = 'Badge';
