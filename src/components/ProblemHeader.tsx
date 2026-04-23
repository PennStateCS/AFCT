import React from 'react';
import { CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type ProblemHeaderProps = {
  title: string;
  description?: string;
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
      'bg-transparent text-emerald-700 border-emerald-300 dark:text-emerald-300 dark:border-emerald-300',
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
    typeBadgeMap[type] || { label: type, className: 'bg-gray-100 text-gray-800 border-gray-200' }
  );
};

export default function ProblemHeader({
  title,
  description,
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
    'inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-transparent px-3 py-1 text-xs font-medium leading-none dark:border-slate-200';

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <CardTitle className="text-lg">{title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
          {badge ? (
            <Badge
              variant="outline"
              className={`inline-flex min-h-8 items-center rounded-full px-3 py-1 ${badge.className}`}
            >
              {badge.label}
            </Badge>
          ) : null}
          {typeof maxStates === 'number' ? (
            <span className={metaPillClass}>Max States: {maxStates === -1 ? 'Unlimited' : maxStates}</span>
          ) : null}
          {typeof isDeterministic === 'boolean' ? (
            <span className={metaPillClass}>{isDeterministic ? 'Deterministic' : 'Nondeterministic'}</span>
          ) : null}
          {submissionsLabel !== null ? (
            <span className={metaPillClass}>Max Submissions: {submissionsLabel}</span>
          ) : null}
          {typeof autograderEnabled === 'boolean' ? (
            <span className={metaPillClass}>Autograder: {autograderEnabled ? 'On' : 'Off'}</span>
          ) : null}
        </div>
      </div>
      {description ? <div className="text-muted-foreground mt-2 text-sm">{description}</div> : null}
    </div>
  );
}
