import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  CircleCheck,
  CircleSlash,
  Gauge,
  ListOrdered,
  Share2,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { BadgeVariant } from '@/lib/badge-presets';
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

/**
 * Icon-led badges for a problem's facts.
 *
 * One mapping rather than conditional classes at each call site, so a new problem type or a
 * new fact is a row here instead of another branch in the markup.
 *
 * Colour comes from the shared badge variants, so these sit in the same language as every
 * other badge in the app rather than composing token classes of their own. Nothing depends
 * on the hue: every badge names itself in text and carries an icon, so the colour is
 * reinforcement rather than the message. That is also why "Autograder" is not styled only
 * for the On case.
 *
 * Which family each fact belongs to is the only real decision here. The problem's type and
 * its determinism are identities, so they take categorical hues; the type used to be amber,
 * which read as a caution about a problem that was simply an FA. The limits are plain
 * metadata. Only the autograder reports a state, and only the On case is a state worth
 * colouring.
 */

const typeLabels: Record<string, string> = {
  PDA: 'Pushdown Automaton',
  RE: 'Regular Expression',
  CFG: 'Context-Free Grammar',
  FA: 'Finite Automaton',
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
  const submissionsLabel =
    typeof maxSubmissions === 'number' ? (maxSubmissions < 0 ? 'Unlimited' : maxSubmissions) : null;
  const hasDescription = !!description || !!descriptionJson;

  const facts: { key: string; icon: LucideIcon; label: string; variant: BadgeVariant }[] = [];
  if (type) {
    facts.push({
      key: 'type',
      icon: Workflow,
      label: typeLabels[type] ?? type,
      variant: 'category-indigo',
    });
  }
  if (typeof maxStates === 'number') {
    facts.push({
      key: 'states',
      icon: Gauge,
      label: `Max States: ${maxStates === -1 ? 'Unlimited' : maxStates}`,
      variant: 'neutral',
    });
  }
  if (typeof isDeterministic === 'boolean') {
    facts.push({
      key: 'det',
      icon: Share2,
      label: isDeterministic ? 'Deterministic' : 'Nondeterministic',
      variant: 'category-blue',
    });
  }
  if (submissionsLabel !== null) {
    facts.push({
      key: 'subs',
      icon: ListOrdered,
      label: `Max Submissions: ${submissionsLabel}`,
      variant: 'neutral',
    });
  }
  if (typeof autograderEnabled === 'boolean') {
    facts.push({
      key: 'ag',
      icon: autograderEnabled ? CircleCheck : CircleSlash,
      label: `Autograder: ${autograderEnabled ? 'On' : 'Off'}`,
      // Off is not a fault, just not switched on, so it reads neutral rather than alarming.
      variant: autograderEnabled ? 'success' : 'neutral',
    });
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <CardTitle className="min-w-0 text-lg">{title}</CardTitle>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {facts.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {facts.map(({ key, icon: Icon, label, variant }) => (
            <Badge key={key} variant={variant} className="gap-1.5 px-2.5 py-1 leading-none">
              {/* Decorative: the label beside it already says the same thing, so announcing
                  the icon would read every badge twice. */}
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {label}
            </Badge>
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
          className="text-muted-foreground mt-3 text-sm"
        />
      ) : null}
    </div>
  );
}
