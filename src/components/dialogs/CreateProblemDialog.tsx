'use client';

import { Problem } from '@prisma/client';
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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import InputGroup from '@/components/ui/InputGroup';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  CreateProblemSchema,
  ProblemFormSchema,
  ProblemTypeEnum,
  type CreateProblemInput,
  type ProblemFormRaw,
} from '@/schemas/problem';
import { showToast } from '@/lib/toast';

// Helper: extract a string message for the file error without using `any`

type CreateProblemDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  onCreated?: (created?: Problem) => void;
};

// RHF state BEFORE transforms
type FormValues = ProblemFormRaw;
// Parsed AFTER Zod transforms
type ParsedValues = CreateProblemInput;

// Default to FA + Unlimited, 100 states (disabled when unlimited)
export function CreateProblemDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  onCreated,
}: CreateProblemDialogProps) {
  const defaults: FormValues = useMemo(
    () => ({
      title: '',
      description: '',
      type: 'FA',
      isUnlimitedSubmissions: true,
      maxSubmissions: 100,
      maxPoints: 100,
      autograderEnabled: true,
      isUnlimitedStates: true,
      maxStates: 100,
      isDeterministic: false,
      file: undefined,
      courseId: courseId,
    }),
    [courseId],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(ProblemFormSchema),
    defaultValues: defaults,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const type = watch('type');
  const isUnlimitedSubmissions = watch('isUnlimitedSubmissions');
  const isUnlimitedStates = watch('isUnlimitedStates');
  const file = watch('file');

  const fileErrorMessage = (() => {
    const e = errors.file;
    if (!e) return '';
    if (typeof e === 'string') return e;
    if (typeof e === 'object' && e !== null) {
      const m = (e as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  })();

  useEffect(() => {
    if (open) {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
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
      // Form submission

      // Parse with CreateProblemSchema which requires file
      const values: ParsedValues = CreateProblemSchema.parse(raw);

      const formData = new FormData();
      formData.append('title', values.title);
      formData.append('description', values.description ?? '');
      formData.append('type', values.type);
      formData.append('maxSubmissions', values.isUnlimitedSubmissions ? '-1' : String(values.maxSubmissions ?? 0));
      formData.append('maxPoints', String(values.maxPoints));
      formData.append('autograderEnabled', String(values.autograderEnabled));
      formData.append('courseId', values.courseId);

      if (values.type === 'FA' || values.type === 'PDA') {
        formData.append('maxStates', values.isUnlimitedStates ? '-1' : String(values.maxStates ?? 0));
      }
      if (values.type === 'FA') {
        formData.append('isDeterministic', String(!!values.isDeterministic));
      }

      formData.append('file', values.file);

      const res = await fetch('/api/problems', { method: 'POST', body: formData });

      if (res.ok) {
        const created = await res.json().catch(() => null);
        onCreated?.(created);
        resetForm();
        setOpen(false);
      } else {
        const msg = await safeMessage(res);
        console.error('Failed to create problem:', msg);
      }
    } catch (error) {
      console.error('Form submission error:', error);
      if (error instanceof z.ZodError) {
        // Handle Zod validation errors
        const message = error.errors?.map((e) => e.message).join();
        showToast.error(`Error: ${message}`);
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
      <DialogContent
        className="bg-card max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create Problem</DialogTitle>
          <DialogDescription>
            Fill in the problem details and upload the solution file.
          </DialogDescription>
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

          {/* Max Submissions */}
          <Controller
            control={control}
            name="maxSubmissions"
            render={({ field }) => (
              <div>
                <InputGroup
                  label="Max Submissions"
                  name="maxSubmissions"
                  type="number"
                  fieldProps={{
                    ...field,
                    value: isUnlimitedSubmissions ? '' : String(field.value || ''),
                  }}
                  min={1}
                  max={1_000}
                  disabled={isUnlimitedSubmissions}
                  error={errors.maxSubmissions?.message}
                />
                <div className="mt-1 flex items-center gap-2">
                  <Controller
                    control={control}
                    name="isUnlimitedSubmissions"
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

          {/* Max Grade */}
          <Controller
            control={control}
            name="maxPoints"
            render={({ field }) => (
              <div>
                <InputGroup
                  label="Max Points"
                  name="maxPoints"
                  type="number"
                  fieldProps={{
                    ...field,
                    value: String(field.value),
                  }}
                  min={1}
                  max={10_000}
                  error={errors.maxPoints?.message}
                />
              </div>
            )}
          />

          {/* Automatic Grading */ }
          <div className="flex items-center justify-between">
            <Label htmlFor="autograderEnabled">Automatic Grading</Label>
            <Controller
              control={control}
              name="autograderEnabled"
              render={({ field }) => (
                <Switch
                  id="autograderEnabled"
                  checked={!!field.value}
                  onCheckedChange={(checked) => field.onChange(!!checked)}
                />
              )}
            />
          </div>

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
                      value: isUnlimitedStates ? '' : String(field.value || ''),
                    }}
                    min={1}
                    max={1_000}
                    disabled={isUnlimitedStates}
                    error={errors.maxStates?.message}
                  />
                  <div className="mt-1 flex items-center gap-2">
                    <Controller
                      control={control}
                      name="isUnlimitedStates"
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
                  <div>
                    <Switch
                      id="isDeterministic"
                      checked={!!field.value}
                      onCheckedChange={(checked) => field.onChange(!!checked)}
                    />
                  </div>
                )}
              />
            </div>
          )}

          {/* File (avoid InputGroup; file inputs must be uncontrolled) */}
          <Controller
            control={control}
            name="file"
            render={({ field: { onChange, onBlur, name, ref } }) => (
              <div>
                <Label htmlFor="answer-file" className="mb-2 block">
                  Answer File
                </Label>
                <Input
                  id="answer-file"
                  name={name}
                  type="file"
                  accept=".txt,.fa,.pda,.cfg,.re,.jff"
                  ref={ref}
                  onBlur={onBlur}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    onChange(file);
                  }}
                />
                {fileErrorMessage && (
                  <p className="mt-1 text-xs text-red-600">{fileErrorMessage}</p>
                )}
              </div>
            )}
          />

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={isSubmitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!isValid || isSubmitting || !file || courseIsArchived}>
              {isSubmitting ? 'Creating…' : 'Create Problem'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

async function safeMessage(res: Response) {
  try {
    const data = await res.json();
    return (
      (data as { message?: string; error?: string })?.message ??
      (data as { message?: string; error?: string })?.error ??
      null
    );
  } catch {
    return null;
  }
}
