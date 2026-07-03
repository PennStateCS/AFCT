import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FormEvent, KeyboardEvent } from 'react';

type ProblemGradeFormProps = {
  value: string;
  currentGrade: number | null;
  disabled?: boolean;
  isSaving?: boolean;
  isLoading?: boolean;
  error?: string | null;
  autograderStatus?: string | null;
  onRerun?: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export default function ProblemGradeForm({
  value,
  currentGrade,
  disabled = false,
  isSaving = false,
  isLoading = false,
  error,
  autograderStatus,
  onRerun,
  onChange,
  onSubmit,
}: ProblemGradeFormProps) {
  const gradeValue = typeof value === 'string' ? value : '';
  const trimmed = gradeValue.trim();
  const parsed = trimmed === '' ? null : Number(trimmed);
  const numericGrade = Number.isNaN(parsed) ? null : parsed;
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

  const status = autograderStatus?.toUpperCase();
  const isPending = status === 'PENDING' || status === 'PROCESSING';
  const isFailed = status === 'FAILED';

  return (
    <div className="flex flex-col gap-2">
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
      <Input
        type="number"
        inputMode="decimal"
        value={gradeValue}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isLoading ? '-' : sanitizedCurrent === null ? '-' : ''}
        className="w-28"
        aria-label="Problem grade"
        disabled={disabled || isLoading || isSaving}
      />
      <Button
        type="submit"
        size="sm"
        className="whitespace-nowrap"
        disabled={disableButton}
      >
        {isSaving ? 'Saving…' : 'Save Grade'}
      </Button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </form>
    </div>
  );
}
