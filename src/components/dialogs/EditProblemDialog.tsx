'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';
import { Input } from '@/components/ui/input';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { Problem } from '@prisma/client';
import { ProblemFormSchema, UpdateProblemSchema, ProblemTypeEnum } from '@/schemas/problem';

type EditProblemDialogProps = {
  problem: Problem;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSaved?: (updated?: Problem) => void;
};

// RHF state BEFORE transforms (matches ProblemFormSchema input)
type FormValues = z.input<typeof ProblemFormSchema>;
type ParsedValues = z.output<typeof ProblemFormSchema>;

// Helpers to adapt persisted values to the form model
function deriveUnlimited(maxStates: number | null): boolean {
  // Treat null or negative as unlimited
  return maxStates == null || maxStates < 0;
}
function deriveMaxStates(maxStates: number | null): number {
  // Use stored value if valid; otherwise a reasonable default for the input
  return maxStates && maxStates > 0 ? maxStates : 100;
}

export function EditProblemDialog({ problem, open, setOpen, onSaved }: EditProblemDialogProps) {
  const defaults: FormValues = useMemo(
    () => ({
      title: problem.title ?? '',
      description: problem.description ?? '',
      type: problem.type as z.infer<typeof ProblemTypeEnum>,
      isUnlimited: deriveUnlimited(problem.maxStates),
      maxStates: deriveMaxStates(problem.maxStates),
      isDeterministic:
        problem.type === 'FA'
          ? !!(problem as Problem & { isDeterministic?: boolean }).isDeterministic
          : false,
      file: undefined as File | undefined, // optional in edit; user can choose a new file
      courseId: problem.courseId,
    }),
    [problem],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(ProblemFormSchema),
    defaultValues: defaults,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Drive conditional UI
  const type = watch('type');
  const isUnlimited = watch('isUnlimited');

  // Reset when opening/closing (prevents touched/error flicker)
  useEffect(() => {
    if (open) {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: true,
      });
    } else {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
    }
  }, [open, defaults, reset]);

  const resetForm = () =>
    reset(defaults, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });

  const onSubmit = async (raw: FormValues) => {
    try {
      console.log('Edit problem form data:', {
        title: raw.title,
        type: raw.type,
        courseId: raw.courseId,
        file: raw.file,
        fileName: raw.file?.name,
        fileSize: raw.file?.size,
      });

      // 1) Normalize with form schema
      const parsed: ParsedValues = ProblemFormSchema.parse(raw);
      // 2) Enforce update contract with id (file stays optional)
      const payload = UpdateProblemSchema.parse({
        id: problem.id,
        ...parsed,
      });

      const formData = new FormData();
      formData.append('title', payload.title ?? '');
      formData.append('description', payload.description ?? '');
      formData.append('type', payload.type ?? '');
      formData.append('courseId', payload.courseId ?? '');

      // FA/PDA maxStates normalization
      if (payload.type === 'FA' || payload.type === 'PDA') {
        const normalizedMax = payload.isUnlimited ? -1 : Number(payload.maxStates ?? 0);
        formData.append('maxStates', String(normalizedMax));
      }

      // FA determinism toggle
      if (payload.type === 'FA') {
        formData.append('isDeterministic', String(!!payload.isDeterministic));
      }

      // Include file ONLY if user selected a new one
      if (payload.file instanceof File) {
        formData.append('file', payload.file);
      }

      console.log('Sending PUT request to:', `/api/problems/${problem.id}`);

      const res = await fetch(`/api/problems/${problem.id}`, {
        method: 'PUT',
        body: formData,
      });

      console.log('Response status:', res.status);

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Edit problem error response:', errorText);
        
        let errorMessage = 'Failed to update problem.';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch {
          // Keep default message if response isn't JSON
        }
        
        console.error('Failed to update problem:', errorMessage);
        return;
      }

      const updated = (await res.json().catch(() => null)) as Problem | null;
      resetForm(); // clear RHF state before closing
      onSaved?.(updated ?? undefined);
      setOpen(false);
    } catch (error) {
      console.error('Edit problem submission error:', error);
      if (error instanceof z.ZodError) {
        console.log('Zod validation errors:', error.errors);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm();
      }}
    >
      <DialogContent className="bg-card max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Problem</DialogTitle>
          <DialogDescription>Update the problem details and save your changes.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Title */}
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

          {/* Description */}
          <Controller
            control={control}
            name="description"
            render={({ field }) => (
              <div>
                <Label className="mb-2 block">Description</Label>
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  rows={4}
                  placeholder="Optional description"
                />
                {errors.description && (
                  <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>
                )}
              </div>
            )}
          />

          {/* Type */}
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <div>
                <Label className="mb-2 block">Problem Type</Label>
                <select
                  className="w-full rounded border p-2"
                  value={field.value}
                  onChange={(e) =>
                    field.onChange(e.target.value as z.infer<typeof ProblemTypeEnum>)
                  }
                >
                  <option value="FA">Finite Automaton</option>
                  <option value="PDA">Push-Down Automaton</option>
                  <option value="CFG">Context-Free Grammar</option>
                  <option value="RE">Regular Expression</option>
                </select>
              </div>
            )}
          />

          {/* Max States (FA/PDA only) */}
          {(type === 'FA' || type === 'PDA') && (
            <Controller
              control={control}
              name="maxStates"
              render={({ field }) => (
                <div>
                  <InputGroup
                    label="Max States"
                    name="maxStates"
                    type="number"
                    fieldProps={{
                      ...field,
                      value: isUnlimited ? '' : String(field.value || ''),
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                        field.onChange(e.target.value),
                    }}
                    min={1}
                    max={1000}
                    disabled={isUnlimited}
                    error={errors.maxStates?.message}
                  />
                  <div className="mt-1 flex items-center gap-2">
                    <Controller
                      control={control}
                      name="isUnlimited"
                      render={({ field: uf }) => (
                        <>
                          <input
                            type="checkbox"
                            checked={!!uf.value}
                            onChange={(e) => uf.onChange(e.target.checked)}
                          />
                          <span className="text-muted-foreground text-sm">Unlimited</span>
                        </>
                      )}
                    />
                  </div>
                </div>
              )}
            />
          )}

          {/* Deterministic (FA only) */}
          {type === 'FA' && (
            <div className="flex items-center justify-between">
              <Label htmlFor="isDeterministic">Deterministic</Label>
              <Controller
                control={control}
                name="isDeterministic"
                render={({ field }) => (
                  <Switch
                    id="isDeterministic"
                    checked={!!field.value}
                    onCheckedChange={(checked) => field.onChange(!!checked)}
                  />
                )}
              />
            </div>
          )}

          {/* File (optional in edit) */}
          <Controller
            control={control}
            name="file"
            render={({ field }) => (
              <div>
                <Label htmlFor="answer-file" className="mb-2 block">
                  Replace Answer File (optional)
                </Label>
                <Input
                  id="answer-file"
                  type="file"
                  accept=".txt,.fa,.pda,.cfg,.re"
                  onChange={(e) => field.onChange(e.target.files?.[0])}
                />
                {errors.file && <p className="mt-1 text-xs text-red-600">{errors.file.message}</p>}
              </div>
            )}
          />

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={isSubmitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!isValid || !isDirty || isSubmitting}
              title={
                !isValid
                  ? 'Fix validation errors to save'
                  : !isDirty
                    ? 'No changes to save'
                    : undefined
              }
            >
              {isSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
