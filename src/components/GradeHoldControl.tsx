'use client';

import { useState } from 'react';
import { Bot, Lock, PenLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { cn } from '@/lib/utils';
import { describeGradeHold, type GradeHoldInput, type GradeHoldState } from '@/lib/grade-hold';

/**
 * Badge styling per state. The icon follows where the grade came from, and a hand-entered
 * grade on an autograded problem is the one worth picking out of a column, so it is the only
 * one that gets a colour. The label differs in every case as well, so colour is never the
 * only thing carrying the meaning (WCAG 1.4.1).
 */
const BADGE: Record<
  GradeHoldState,
  { variant: 'info' | 'neutral' | 'outline'; Icon: typeof Lock | null }
> = {
  'manual-override': { variant: 'info', Icon: PenLine },
  'manually-graded': { variant: 'neutral', Icon: PenLine },
  autograded: { variant: 'neutral', Icon: Bot },
  'not-graded': { variant: 'outline', Icon: null },
};

/**
 * Where a grade came from, as a badge, with a padlock when a re-run cannot change it.
 * Read-only, for places that list grades rather than act on them (the gradebook's
 * breakdown).
 */
export function GradeHoldBadge({
  className,
  ...input
}: GradeHoldInput & { className?: string }) {
  const { state, label, detail, held } = describeGradeHold(input);
  const { variant, Icon } = BADGE[state];

  // The padlock says the autograder will not touch this grade, which is only a fact worth
  // showing where the autograder would otherwise run. On a hand-graded problem every grade
  // is safe, and a padlock on all of them would imply a danger that does not exist there.
  const showHold = held && input.autograderEnabled && input.hasGrade;

  return (
    <Badge variant={variant} className={cn('font-normal', className)} title={detail}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {label}
      {showHold ? (
        <>
          <Lock aria-hidden="true" />
          {/* The padlock is the only thing marking a held grade, so it needs words too. */}
          <span className="sr-only">, held</span>
        </>
      ) : null}
    </Badge>
  );
}

/**
 * How the problem itself is graded, as a badge. A property of the problem, so it reads the
 * same whether or not anyone has been graded on it.
 *
 * Pairs with `GradeOriginBadge`: side by side in a table those two answer "how is this meant
 * to be graded" and "who actually graded it", which is the pair `GradeHoldBadge` has to cross
 * into one label when there is only room for one.
 */
export function ProblemGradingBadge({
  autograderEnabled,
  className,
}: {
  autograderEnabled: boolean;
  className?: string;
}) {
  const { problemGrading } = describeGradeHold({
    autograderEnabled,
    // Neither of these reaches the half being read, but the resolver takes whole input.
    gradeSource: 'AUTOGRADER',
    gradedManually: false,
    hasGrade: false,
  }).parts;

  return (
    <Badge
      variant="neutral"
      className={cn('font-normal', className)}
      title={problemGrading.detail}
    >
      {autograderEnabled ? <Bot aria-hidden="true" /> : <PenLine aria-hidden="true" />}
      {problemGrading.label}
    </Badge>
  );
}

/**
 * Who produced this particular score, as a badge, with a padlock when a re-run cannot change
 * it. Says nothing about how the problem is configured; `ProblemGradingBadge` is that half.
 */
export function GradeOriginBadge({
  className,
  ...input
}: GradeHoldInput & { className?: string }) {
  const { parts, held, emphasis } = describeGradeHold(input);
  const { origin } = parts;

  const Icon = !input.hasGrade ? null : input.gradeSource === 'MANUAL' ? PenLine : Bot;
  // Emphasized only where a person overrode an autograder that would otherwise have graded
  // this. Reading it beside the Grading column, that is the row worth stopping on.
  const variant = !input.hasGrade ? 'outline' : emphasis ? 'info' : 'neutral';
  const showHold = held && input.autograderEnabled && input.hasGrade;

  return (
    <Badge variant={variant} className={cn('font-normal', className)} title={origin.detail}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {origin.label}
      {showHold ? (
        <>
          <Lock aria-hidden="true" />
          {/* The padlock is the only thing marking a held grade, so it needs words too. */}
          <span className="sr-only">, held</span>
        </>
      ) : null}
    </Badge>
  );
}

type GradeHoldControlProps = GradeHoldInput & {
  /** Hold this grade against the autograder, or hand it back. */
  onChange: (hold: boolean) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
};

/**
 * The state of one grade, plus the single action that changes it.
 *
 * This replaced a switch. The switch was on for every hand-entered grade (saving a grade
 * sets the flag), so it read as something a grader had to turn on to protect their work,
 * and it presented two symmetric positions for two very asymmetric acts: releasing a grade
 * can change a student's mark on a later re-run with nobody touching it, while holding one
 * cannot hurt anybody. A button named for its consequence, and a confirmation on the one
 * direction that deserves it, says what the switch never did.
 *
 * Renders nothing when there is no action to offer, which covers both cases where the
 * control would be noise: a problem the autograder does not grade (nothing would overwrite
 * the grade) and a problem with no grade yet (there is nothing to hold, and the endpoint
 * rightly refuses to invent one).
 */
export function GradeHoldControl({
  onChange,
  disabled = false,
  className,
  ...input
}: GradeHoldControlProps) {
  const { detail, action } = describeGradeHold(input);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (!action) return null;

  const apply = async () => {
    setPending(true);
    try {
      await onChange(action.hold);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {/* flex-wrap: the badge and a button named for its consequence ("Lock this grade") do
          not fit one line in the 30%-wide grade column, and the button does not wrap its
          label, so it ran past the panel. It drops under the badge instead, still right
          aligned by ml-auto. */}
      <div className="flex flex-wrap items-center gap-2">
        <GradeHoldBadge {...input} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-7 text-xs"
          disabled={disabled || pending}
          onClick={() => (action.confirm ? setConfirming(true) : void apply())}
        >
          {action.label}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{detail}</p>

      {action.confirm ? (
        <ConfirmDialog
          open={confirming}
          title={action.confirm.title}
          description={action.confirm.description}
          confirmText={action.confirm.confirmText}
          onConfirm={async () => {
            await apply();
            setConfirming(false);
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}

export default GradeHoldControl;
