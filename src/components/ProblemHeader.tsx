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

  // One bar of facts rather than five pills. Each fact stays a single text node so it reads
  // as one phrase, and so it can still be found by its whole label.
  const hasDescription = !!description || !!descriptionJson;
  const facts: React.ReactNode[] = [];
  if (badge) {
    facts.push(
      <span key="type" className={`font-medium ${badge.className}`}>
        {badge.label}
      </span>,
    );
  }
  if (typeof maxStates === 'number') {
    facts.push(<span key="states">Max States: {maxStates === -1 ? 'Unlimited' : maxStates}</span>);
  }
  if (typeof isDeterministic === 'boolean') {
    facts.push(<span key="det">{isDeterministic ? 'Deterministic' : 'Nondeterministic'}</span>);
  }
  if (submissionsLabel !== null) {
    facts.push(<span key="subs">Max Submissions: {submissionsLabel}</span>);
  }
  if (typeof autograderEnabled === 'boolean') {
    facts.push(<span key="ag">Autograder: {autograderEnabled ? 'On' : 'Off'}</span>);
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <CardTitle className="min-w-0 text-lg">{title}</CardTitle>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {/* The facts and the description are one unit: the bar reads as the description's
          header, the same shape as the Submissions and Discussion panels beside it, rather
          than a row of loose pills floating above unrelated text. */}
      {facts.length > 0 || hasDescription ? (
        <section className="mt-2 overflow-hidden rounded-md border">
          {facts.length > 0 ? (
            <div
              className={`text-foreground bg-accent flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs ${
                hasDescription ? 'border-b' : ''
              }`}
            >
              {facts.map((fact, i) => (
                <React.Fragment key={i}>
                  {i > 0 ? (
                    <span aria-hidden="true" className="text-muted-foreground/60">
                      •
                    </span>
                  ) : null}
                  {fact}
                </React.Fragment>
              ))}
            </div>
          ) : null}
          {hasDescription ? (
            <RichDescription
              // Heading base: the CardTitle above is aria-level 3, so the description starts one level below it.
              headingBaseLevel={4}
              compact
              description={description}
              descriptionJson={descriptionJson}
              className="text-muted-foreground px-3 py-2 text-sm"
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
