'use client';

import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';
import type { ProblemFormRaw } from '@/schemas/problem';

type ProblemBasicFieldsProps = {
  control: Control<ProblemFormRaw>;
  errors: FieldErrors<ProblemFormRaw>;
};

/**
 * The title / description / problem-type fields shared by the Create and Edit problem
 * dialogs. The dialogs' other fields (states/determinism/file for create, per-assignment
 * point/submission settings for edit) genuinely differ and stay in each dialog.
 */
export function ProblemBasicFields({ control, errors }: ProblemBasicFieldsProps) {
  return (
    <>
      <Controller
        control={control}
        name="title"
        render={({ field }) => (
          <InputGroup
            label="Title"
            name="title"
            fieldProps={field}
            error={errors.title?.message}
            showStatus
            isValid={!errors.title && !!field.value}
          />
        )}
      />

      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <div>
            <Label htmlFor="problem-description" className="mb-2 block">
              Description
            </Label>
            <Textarea
              {...field}
              id="problem-description"
              value={field.value ?? ''}
              rows={4}
              placeholder="Optional description"
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={errors.description ? 'problem-description-error' : undefined}
            />
            {errors.description && (
              <p id="problem-description-error" role="alert" className="mt-1 text-xs text-red-600">
                {errors.description.message}
              </p>
            )}
          </div>
        )}
      />

      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <div>
            <Label htmlFor="problem-type" className="mb-2 block">
              Problem Type
            </Label>
            <select
              id="problem-type"
              className="w-full rounded border p-2"
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value as ProblemFormRaw['type'])}
            >
              <option value="FA">Finite Automaton</option>
              <option value="PDA">Push-Down Automaton</option>
              <option value="CFG">Context-Free Grammar</option>
              <option value="RE">Regular Expression</option>
            </select>
          </div>
        )}
      />
    </>
  );
}
