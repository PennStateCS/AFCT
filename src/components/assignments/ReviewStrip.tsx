'use client';

import type React from 'react';
import type { StudentNavigatorStudent } from '@/components/StudentNavigator';
import StudentNavigator from '@/components/StudentNavigator';
import { ProblemPicker, type PickableProblem } from '@/components/assignments/ProblemPicker';
import { Check } from 'lucide-react';
import { SubmissionMetaItem } from '@/components/assignments/SubmissionMetaItem';
import {
  StudentSchedule,
  type ScheduleBase,
  type EffectiveSchedule,
} from '@/components/assignments/StudentSchedule';

type ReviewStripProps = {
  students: StudentNavigatorStudent[];
  selectedIndex: number;
  onSelectStudent: (studentId: string) => void;
  onPrevStudent: () => void;
  onNextStudent: () => void;
  gradeStatuses: Record<string, boolean>;
  earnedByStudent: Record<string, number>;
  groupInfo: React.ComponentProps<typeof StudentNavigator>['groupInfo'];

  problems: PickableProblem[];
  selectedProblemId: string | null;
  onSelectProblem: (problemId: string) => void;
  problemGrades: Record<string, number | null>;

  assignment: ScheduleBase | null;
  effective?: EffectiveSchedule | null;
  timezone: string;
  /** The installation's clock preference, passed on to the schedule below. */
  hour12?: boolean;

  totals: { totalPoints: number; earned: number; graded: number; count: number };
  className?: string;
};

/**
 * The bar above the review panels: who is being reviewed, which problem, when their work was
 * due, and how the assignment is going.
 *
 * Its own component because it is one idea made of five cells, and inline it was the largest
 * single block in a page that had already been split into hooks. Nothing here holds state:
 * every value and handler comes from the page.
 */
export function ReviewStrip({
  students,
  selectedIndex,
  onSelectStudent,
  onPrevStudent,
  onNextStudent,
  gradeStatuses,
  earnedByStudent,
  groupInfo,
  problems,
  selectedProblemId,
  onSelectProblem,
  problemGrades,
  assignment,
  effective = null,
  timezone,
  hour12 = true,
  totals,
  className = '',
}: ReviewStripProps) {
  // The assignment is 0/0 when it has no problems yet. Say "graded" of nothing rather than
  // dividing by zero anywhere.
  const allGraded = totals.count > 0 && totals.graded === totals.count;

  return (
    // Two rows: what is being reviewed, and the facts about it. The pickers are what a grader
    // operates, so they get the width and the top; the readings underneath are a glance.
    //
    // bg-card, like the two panels it sits above. It was a transparent outline, which was
    // invisible while the workspace was white and left the strip reading as a gap between the
    // tab heading and the review below it rather than as the header of it.
    <div className={`bg-card flex flex-col gap-2.5 rounded-md border p-3 sm:px-4 ${className}`}>
      {/* Side by side from md, stacked below it: two segmented controls sharing a phone's
          width leaves nothing for the names they exist to show. */}
      {/* 45/55 once there is room: a problem title carries its number and is the longer of
          the two, and an even split left the student control ending mid-column. */}
      <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-[45fr_55fr]">
        <StudentNavigator
          students={students}
          selectedIndex={selectedIndex}
          onSelectStudent={onSelectStudent}
          onPrev={onPrevStudent}
          onNext={onNextStudent}
          gradeStatuses={gradeStatuses}
          earnedByStudent={earnedByStudent}
          totalPoints={totals.totalPoints}
          groupInfo={groupInfo}
        />
        <ProblemPicker
          problems={problems}
          selectedProblemId={selectedProblemId}
          onSelect={onSelectProblem}
          grades={problemGrades}
        />
      </div>

      {/* Two columns on a phone, four once there is room. auto-fit rather than a breakpoint
          would reflow at widths nobody chose; these two are the shapes that read well. */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-2.5 lg:grid-cols-4">
        <StudentSchedule
          assignment={assignment}
          effective={effective}
          loading={!assignment}
          timezone={timezone}
          hour12={hour12}
        />
        <SubmissionMetaItem label="Graded">
          <span className="inline-flex items-center gap-1 tabular-nums">
            {/* A tick as well as the numbers, so "finished" is not carried by colour, and
                only once there is nothing left to grade. */}
            {allGraded ? <Check className="text-status-success size-4" aria-hidden="true" /> : null}
            {totals.graded}/{totals.count}
          </span>
          <span className="sr-only">
            {totals.graded} of {totals.count} problems graded
          </span>
        </SubmissionMetaItem>
        <SubmissionMetaItem label="Score" emphasis>
          {totals.earned} / {totals.totalPoints}
          <span className="sr-only"> points</span>
        </SubmissionMetaItem>
      </div>
    </div>
  );
}

export default ReviewStrip;
