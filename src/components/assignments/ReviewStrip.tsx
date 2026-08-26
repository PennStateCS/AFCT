'use client';

import type React from 'react';
import type { StudentNavigatorStudent } from '@/components/StudentNavigator';
import StudentNavigator from '@/components/StudentNavigator';
import { ProblemPicker, type PickableProblem } from '@/components/assignments/ProblemPicker';
import { ProgressRing } from '@/components/assignments/ProgressRing';
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
  totals,
  className = '',
}: ReviewStripProps) {
  // Divided into cells rather than spaced apart, so the regions read as parts of one control
  // strip instead of loose groups.
  //
  // bg-card, like the two panels it sits above. It was a transparent outline, which was
  // invisible while the workspace was white and left the strip reading as a gap between the
  // tab heading and the review below it rather than as the header of it.
  return (
    <div
      className={`bg-card flex flex-col divide-y rounded-md border xl:flex-row xl:items-stretch xl:divide-x xl:divide-y-0 xl:py-3 ${className}`}
    >
      <div className="flex min-w-0 items-center px-4 py-2 xl:flex-auto xl:py-0">
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
      </div>
      <div className="flex min-w-0 items-center px-4 py-2 xl:flex-auto xl:py-0">
        <ProblemPicker
          problems={problems}
          selectedProblemId={selectedProblemId}
          onSelect={onSelectProblem}
          grades={problemGrades}
        />
      </div>
      <StudentSchedule
        assignment={assignment}
        effective={effective}
        loading={!assignment}
        timezone={timezone}
      />
      {/* A cell each, so the strip's rules separate them the way they separate the
            dates from the picker. They answer different questions: how much is done,
            and how it is going. */}
      {/* Dropped first when the bar is tight: how many problems are graded is the
            least load-bearing figure here, and the picker already shows it per problem. */}
      <div className="hidden min-w-0 items-center px-4 py-2 xl:flex-auto xl:py-0 2xl:flex">
        <ProgressRing
          label="Problems graded"
          value={totals.graded}
          total={totals.count}
          srLabel={`${totals.graded} of ${totals.count} problems graded`}
        />
      </div>
      <div className="flex min-w-0 items-center px-4 py-2 xl:flex-auto xl:py-0">
        <ProgressRing
          label="Assignment score"
          value={totals.earned}
          total={totals.totalPoints}
          // Only once everything is graded is the shortfall actually points lost.
          remainderTone={totals.count > 0 && totals.graded === totals.count ? 'danger' : 'muted'}
          srLabel={`${totals.earned} of ${totals.totalPoints} points`}
        />
      </div>
    </div>
  );
}

export default ReviewStrip;
