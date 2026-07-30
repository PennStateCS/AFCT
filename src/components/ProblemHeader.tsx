import React from 'react';
import { CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RichDescription } from '@/components/rich-description/RichDescription';

type ProblemHeaderProps = {
  title: string;
  description?: string;
  /** The stored rich description, when the problem has one. */
  descriptionJson?: unknown;
  type?: string;
  maxStates?: number;
  isDeterministic?: boolean;
  maxSubmissions?: number;
  autograderEnabled?: boolean;
  className?: string;
};

const typeBadgeMap: Record<string, { label: string; className: string }> = {
  PDA: {
    label: 'Pushdown Automaton',
    className:
      'bg-transparent text-purple-700 border-purple-300 dark:text-purple-300 dark:border-purple-300',
  },
  RE: {
    label: 'Regular Expression',
    className:
      'bg-transparent text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-300',
  },
  CFG: {
    label: 'Context-Free Grammar',
    className:
      'bg-transparent text-green-700 border-green-300 dark:text-green-300 dark:border-green-300',
  },
  FA: {
    label: 'Finite Automaton',
    className:
      'bg-transparent text-orange-700 border-orange-300 dark:text-orange-300 dark:border-orange-300',
  },
};

const getTypeBadge = (type?: string) => {
  if (!type) return null;
  return (
    typeBadgeMap[type] || {
      label: type,
      className: 'bg-transparent text-muted-foreground border-border',
    }
  );
};

export default function ProblemHeader({
  title,
  description,
  descriptionJson,
  type,
  maxStates,
  isDeterministic,
  maxSubmissions,
  autograderEnabled,
  className,
}: ProblemHeaderProps) {
  const badge = getTypeBadge(type);
  const submissionsLabel =
    typeof maxSubmissions === 'number' ? (maxSubmissions < 0 ? 'Unlimited' : maxSubmissions) : null;
  const metaPillClass =
    'inline-flex min-h-8 items-center rounded-full border border-border bg-transparent px-3 py-1 text-xs font-medium leading-none';

  return (
    <div className={className}>
      <CardTitle className="text-lg">{title}</CardTitle>
      <div className="text-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
        {badge ? (
          <Badge
            variant="outline"
            className={`inline-flex min-h-8 items-center rounded-full px-3 py-1 ${badge.className}`}
          >
            {badge.label}
          </Badge>
        ) : null}
        {typeof maxStates === 'number' ? (
          <span className={metaPillClass}>
            Max States: {maxStates === -1 ? 'Unlimited' : maxStates}
          </span>
        ) : null}
        {typeof isDeterministic === 'boolean' ? (
          <span className={metaPillClass}>
            {isDeterministic ? 'Deterministic' : 'Nondeterministic'}
          </span>
        ) : null}
        {submissionsLabel !== null ? (
          <span className={metaPillClass}>Max Submissions: {submissionsLabel}</span>
        ) : null}
        {typeof autograderEnabled === 'boolean' ? (
          <span className={metaPillClass}>Autograder: {autograderEnabled ? 'On' : 'Off'}</span>
        ) : null}
      </div>
      {description || descriptionJson ? (
        <RichDescription
          // Heading base: the CardTitle above is aria-level 3, so the description starts one level below it.
          headingBaseLevel={4}
          compact
          description={description}
          descriptionJson={descriptionJson}
          className="text-muted-foreground mt-2 text-sm"
        />
      ) : null}
    </div>
  );
}
