'use client';

import React, { useId } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export function DueDateSection({
  id,
  icon,
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('bg-card overflow-hidden rounded-xl border shadow-xs', className)}
    >
      <div className="bg-muted/25 flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span
            className="bg-primary/10 text-primary mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
            aria-hidden="true"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h3 id={id} className="text-sm font-semibold">
              {title}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{description}</p>
          </div>
        </div>
        {action ? <div className="shrink-0 sm:min-w-64">{action}</div> : null}
      </div>
      <div className={cn('p-4', contentClassName)}>{children}</div>
    </section>
  );
}

export type OverrideLatePolicy = boolean | null | undefined;

export function OverrideLatePolicyField({
  value,
  onChange,
  defaultAllowsLate,
  id,
}: {
  value: OverrideLatePolicy;
  onChange: (value: OverrideLatePolicy) => void;
  defaultAllowsLate: boolean;
  id?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = `${fieldId}-description`;
  const selectValue = value === true ? 'allow' : value === false ? 'block' : 'inherit';

  return (
    <div className="flex flex-col">
      <Label htmlFor={fieldId} className="mb-1.5 text-sm font-medium">
        Late submissions
      </Label>
      <Select
        value={selectValue}
        onValueChange={(next) =>
          onChange(next === 'allow' ? true : next === 'block' ? false : undefined)
        }
      >
        <SelectTrigger
          id={fieldId}
          aria-describedby={descriptionId}
          // bg-card + border-black so it reads like the InputGroup date fields beside it
          // (the default border-input gray made the whole control look gray).
          className="bg-card h-11 w-full border-black"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">
            Use default ({defaultAllowsLate ? 'allowed' : 'not allowed'})
          </SelectItem>
          <SelectItem value="allow">Allow late submissions</SelectItem>
          <SelectItem value="block">Close at due date</SelectItem>
        </SelectContent>
      </Select>
      <p id={descriptionId} className="text-muted-foreground mt-1 text-xs">
        {selectValue === 'inherit'
          ? 'Follows the assignment default.'
          : selectValue === 'allow'
            ? 'Accept work after this due date.'
            : 'Do not accept work after this due date.'}
      </p>
    </div>
  );
}
