import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Badge } from '@/components/ui/badge';
import type { FormEvent, KeyboardEvent } from 'react';

/** Who a saved grade applies to. Group assignments only; otherwise there is no choice. */
export type GradeAudience = {
  group: { id: string; name: string } | null;
  studentName: string;
  target: 'student' | 'group';
  onTargetChange: (target: 'student' | 'group') => void;
};

type ProblemGradeFormProps = {
  value: string;
  currentGrade: number | null;
  /** Points the problem is worth, shown as a static "/N" suffix after the input. */
  maxPoints?: number | null;
  disabled?: boolean;
  isSaving?: boolean;
  isLoading?: boolean;
  error?: string | null;
  autograderStatus?: string | null;
  onRerun?: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Omit on individual assignments. */
  audience?: GradeAudience | null;
  /**
   * The value this student's group was given, when the grade came from a group grade. A
   * current grade that differs from it means somebody changed this member deliberately.
   */
  groupGradeValue?: number | null;
};

export default function ProblemGradeForm({
  value,
  currentGrade,
  maxPoints,
  disabled = false,
  isSaving = false,
  isLoading = false,
  error,
  onChange,
  onSubmit,
  audience = null,
  groupGradeValue = null,
}: ProblemGradeFormProps) {
  const gradeValue = typeof value === 'string' ? value : '';
  const trimmed = gradeValue.trim();
  const parsed = trimmed === '' ? null : Number(trimmed);
  const sanitizedCurrent = typeof currentGrade === 'number' ? currentGrade : null;
  const isNumeric = trimmed === '' ? true : !Number.isNaN(parsed);
  const isDirty =
    trimmed === ''
      ? sanitizedCurrent !== null
      : sanitizedCurrent !== (Number.isNaN(parsed) ? null : parsed);
  const disableButton = disabled || !isNumeric || !isDirty || isSaving || isLoading;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!disableButton) onSubmit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (sanitizedCurrent === null || sanitizedCurrent === undefined) {
        onChange('');
      } else {
        onChange(String(sanitizedCurrent));
      }
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!disableButton) onSubmit();
  };

  // Only meaningful once a group grade has been applied: without the recorded value, a grade
  // that differs from the rest of the group could equally be a group never graded together.
  const isAdjusted =
    typeof groupGradeValue === 'number' &&
    sanitizedCurrent !== null &&
    sanitizedCurrent !== groupGradeValue;

  return (
    <div className="flex flex-col gap-2">
      {/* Group assignments only. Defaults to the group, because one submission earns one
          grade; grading member by member is the same number typed N times, where a typo on
          the fourth is invisible. */}
      {audience?.group && !disabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">Grade</span>
          <SegmentedControl
            name="grade-audience"
            value={audience.target}
            onValueChange={(v) => audience.onTargetChange(v as 'student' | 'group')}
            ariaLabel="Who this grade applies to"
            options={[
              { value: 'group', label: audience.group.name },
              { value: 'student', label: `Only ${audience.studentName}` },
            ]}
          />
          {isAdjusted ? (
            <Badge variant="outline" className="text-[0.7rem] font-normal">
              Adjusted from {groupGradeValue}
            </Badge>
          ) : null}
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
        {/* Input, a static "/N" points suffix, and the button, joined into one
            segmented control. The admin types the earned points; "/N" shows the total
            the problem is worth. */}
        <div className="flex w-fit items-stretch">
          <Input
            type="number"
            inputMode="decimal"
            value={gradeValue}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? '-' : sanitizedCurrent === null ? '-' : ''}
            className="w-20 rounded-r-none border-r-0 focus-visible:z-10"
            aria-label={
              maxPoints === null || maxPoints === undefined
                ? 'Problem grade'
                : `Problem grade out of ${maxPoints}`
            }
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'problem-grade-error' : undefined}
            disabled={disabled || isLoading || isSaving}
          />
          {maxPoints === null || maxPoints === undefined ? null : (
            <span
              aria-hidden="true"
              className="border-input text-muted-foreground flex items-center border border-x-0 pr-2 pl-1 text-sm whitespace-nowrap select-none"
            >
              /{maxPoints}
            </span>
          )}
          <Button type="submit" className="rounded-l-none whitespace-nowrap" disabled={disableButton}>
            {isSaving ? 'Saving…' : 'Save Grade'}
          </Button>
        </div>
        {error ? (
        <p id="problem-grade-error" role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      </form>
    </div>
  );
}
