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
    className: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  RE: { label: 'Regular Expression', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  CFG: {
    label: 'Context-Free Grammar',
    className: 'bg-green-100 text-green-800 border-green-200',
  },
  FA: { label: 'Finite Automaton', className: 'bg-orange-100 text-orange-800 border-orange-200' },
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

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <CardTitle className="text-lg">{title}</CardTitle>
        <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
          {badge ? (
            <Badge variant="outline" className={badge.className}>
              {badge.label}
            </Badge>
          ) : null}
          {typeof maxStates === 'number' ? (
            <span>Max States: {maxStates === -1 ? 'Unlimited' : maxStates}</span>
          ) : null}
          {typeof isDeterministic === 'boolean' ? (
            <span>{isDeterministic ? 'Deterministic' : 'Nondeterministic'}</span>
          ) : null}
          {submissionsLabel !== null ? <span>Max Submissions: {submissionsLabel}</span> : null}
          {typeof autograderEnabled === 'boolean' ? (
            <span>Autograder: {autograderEnabled ? 'On' : 'Off'}</span>
          ) : null}
        </div>
      </div>
      {description ? <div className="text-muted-foreground mt-2 text-sm">{description}</div> : null}
    </div>
  );
}
