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
 * Colour comes from the semantic status tokens, which already carry a soft background, a
 * border and a readable foreground in both themes. Nothing depends on the hue: every badge
 * names itself in text and carries an icon, so the colour is reinforcement rather than the
 * message. That is also why "Autograder" is not styled only for the On case.
 */
type BadgeTone = 'type' | 'neutral' | 'info' | 'success';

const toneClasses: Record<BadgeTone, string> = {
  type: 'bg-status-warning-bg border-status-warning-border text-status-warning',
  info: 'bg-status-info-bg border-status-info-border text-status-info',
  success: 'bg-status-success-bg border-status-success-border text-status-success',
  neutral: 'bg-badge-neutral-bg border-badge-neutral-border text-badge-neutral',
};

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

  const badgeClass =
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none';

  const facts: { key: string; icon: LucideIcon; label: string; tone: BadgeTone }[] = [];
  if (type) {
    facts.push({ key: 'type', icon: Workflow, label: typeLabels[type] ?? type, tone: 'type' });
  }
  if (typeof maxStates === 'number') {
    facts.push({
      key: 'states',
      icon: Gauge,
      label: `Max States: ${maxStates === -1 ? 'Unlimited' : maxStates}`,
      tone: 'neutral',
    });
  }
  if (typeof isDeterministic === 'boolean') {
    facts.push({
      key: 'det',
      icon: Share2,
      label: isDeterministic ? 'Deterministic' : 'Nondeterministic',
      tone: 'info',
    });
  }
  if (submissionsLabel !== null) {
    facts.push({
      key: 'subs',
      icon: ListOrdered,
      label: `Max Submissions: ${submissionsLabel}`,
      tone: 'neutral',
    });
  }
  if (typeof autograderEnabled === 'boolean') {
    facts.push({
      key: 'ag',
      icon: autograderEnabled ? CircleCheck : CircleSlash,
      label: `Autograder: ${autograderEnabled ? 'On' : 'Off'}`,
      // Off is not a fault, just not switched on, so it reads neutral rather than alarming.
      tone: autograderEnabled ? 'success' : 'neutral',
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
          {facts.map(({ key, icon: Icon, label, tone }) => (
            <span key={key} className={`${badgeClass} ${toneClasses[tone]}`}>
              {/* Decorative: the label beside it already says the same thing, so announcing
                  the icon would read every badge twice. */}
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {label}
            </span>
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
