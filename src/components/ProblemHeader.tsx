import React from 'react';
import { CardTitle } from '@/components/ui/card';
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
  /**
   * Control shown on the title's row, such as the grade field. It sits here rather than as a
   * sibling so the facts-and-description box below can span the full width instead of
   * stopping where that control begins.
   */
  action?: React.ReactNode;
};

// The problem type keeps its colour, as the one thing here worth picking out at a glance.
// Colour is decorative rather than load-bearing: the type is spelled out beside it, so
// nothing is lost to a reader who cannot distinguish the hues.
const typeBadgeMap: Record<string, { label: string; className: string }> = {
  PDA: { label: 'Pushdown Automaton', className: 'text-purple-700 dark:text-purple-300' },
  RE: { label: 'Regular Expression', className: 'text-blue-700 dark:text-blue-300' },
  CFG: { label: 'Context-Free Grammar', className: 'text-green-700 dark:text-green-300' },
  FA: { label: 'Finite Automaton', className: 'text-orange-700 dark:text-orange-300' },
};

const getTypeBadge = (type?: string) => {
  if (!type) return null;
  return (
    typeBadgeMap[type] || { label: type, className: 'text-muted-foreground' }
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
  action,
}: ProblemHeaderProps) {
  const badge = getTypeBadge(type);
  const submissionsLabel =
    typeof maxSubmissions === 'number' ? (maxSubmissions < 0 ? 'Unlimited' : maxSubmissions) : null;

  const hasDescription = !!description || !!descriptionJson;
  const pillClass =
    'inline-flex min-h-8 items-center rounded-full border border-border bg-transparent px-3 py-1 text-xs font-medium leading-none';
  const facts: React.ReactNode[] = [];
  if (badge) {
    facts.push(
      <span key="type" className={`${pillClass} ${badge.className}`}>
        {badge.label}
      </span>,
    );
  }
  if (typeof maxStates === 'number') {
    facts.push(
      <span key="states" className={pillClass}>
        Max States: {maxStates === -1 ? 'Unlimited' : maxStates}
      </span>,
    );
  }
  if (typeof isDeterministic === 'boolean') {
    facts.push(
      <span key="det" className={pillClass}>
        {isDeterministic ? 'Deterministic' : 'Nondeterministic'}
      </span>,
    );
  }
  if (submissionsLabel !== null) {
    facts.push(
      <span key="subs" className={pillClass}>
        Max Submissions: {submissionsLabel}
      </span>,
    );
  }
  if (typeof autograderEnabled === 'boolean') {
    facts.push(
      <span key="ag" className={pillClass}>
        Autograder: {autograderEnabled ? 'On' : 'Off'}
      </span>,
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <CardTitle className="min-w-0 text-lg">{title}</CardTitle>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {facts.length > 0 ? (
        <div className="text-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">{facts}</div>
      ) : null}
      {hasDescription ? (
        <RichDescription
          // Heading base: the CardTitle above is aria-level 3, so the description starts one level below it.
          headingBaseLevel={4}
          compact
          description={description}
          descriptionJson={descriptionJson}
          className="text-muted-foreground mt-3 text-sm"
        />
      ) : null}
    </div>
  );
}
