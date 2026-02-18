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

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { Problem } from '@prisma/client';
import { ProblemFormSchema, UpdateProblemSchema, ProblemTypeEnum } from '@/schemas/problem';
import { showToast } from '@/lib/toast';

type AssignmentProblemSettings = {
  assignmentId: string;
  courseId: string;
  maxPoints: number;
  maxSubmissions: number;
  autograderEnabled: boolean;
};

type EditProblemDialogProps = {
  courseIsArchived: boolean;
  problem: Problem;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSaved?: (updated?: Problem) => void;
  assignmentSettings?: AssignmentProblemSettings | null;
};

// RHF state BEFORE transforms (matches ProblemFormSchema input)
type FormValues = z.input<typeof ProblemFormSchema>;
type ParsedValues = z.output<typeof ProblemFormSchema>;

export function EditProblemDialog({
  courseIsArchived,
  problem,
  open,
  setOpen,
  onSaved,
  assignmentSettings,
}: EditProblemDialogProps) {
  const defaults: FormValues = useMemo(
    () => ({
      title: problem.title ?? '',
      description: problem.description ?? '',
      type: problem.type as z.infer<typeof ProblemTypeEnum>,
      isUnlimited: problem.maxStates == null || problem.maxStates < 0,
      maxStates: problem.maxStates ?? undefined,
      isDeterministic:
        problem.type === 'FA'
          ? !!(problem as Problem & { isDeterministic?: boolean }).isDeterministic
          : false,
      file: undefined as File | undefined, // optional in edit; user can choose a new file
      courseId: problem.courseId,
    }),
    [problem],
  );

  const assignmentDefaults = useMemo(() => {
    if (!assignmentSettings) return null;
    return {
      maxPoints: assignmentSettings.maxPoints,
      maxSubmissions: assignmentSettings.maxSubmissions,
      autograderEnabled: assignmentSettings.autograderEnabled,
    };
  }, [assignmentSettings]);

  const [assignmentConfig, setAssignmentConfig] = useState(
    assignmentDefaults ?? {
      maxPoints: assignmentSettings?.maxPoints ?? 0,
      maxSubmissions: assignmentSettings?.maxSubmissions ?? -1,
      autograderEnabled: assignmentSettings?.autograderEnabled ?? true,
    },
  );

  const assignmentUnlimited = assignmentConfig.maxSubmissions === -1;
  const assignmentDirty = Boolean(
    assignmentSettings &&
    assignmentDefaults &&
    (assignmentConfig.maxPoints !== assignmentDefaults.maxPoints ||
      assignmentConfig.maxSubmissions !== assignmentDefaults.maxSubmissions ||
      assignmentConfig.autograderEnabled !== assignmentDefaults.autograderEnabled),
  );
  const assignmentMaxPointsInvalid = Boolean(assignmentSettings && assignmentConfig.maxPoints < 0);
  const assignmentMaxSubmissionsInvalid = Boolean(
    assignmentSettings &&
    assignmentConfig.maxSubmissions !== -1 &&
    assignmentConfig.maxSubmissions < 1,
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isValid, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(ProblemFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  // Drive conditional UI
  const type = watch('type');
  const isUnlimited = watch('isUnlimited');

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

  // Reset when opening/closing (prevents touched/error flicker)
  useEffect(() => {
    if (open) {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: true,
      });
      if (assignmentDefaults) {
        setAssignmentConfig(assignmentDefaults);
      }
    } else {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
      if (assignmentDefaults) {
        setAssignmentConfig(assignmentDefaults);
      }
    }
  }, [open, defaults, reset, assignmentDefaults]);

  const resetForm = () => {
    reset(defaults, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });
    if (assignmentDefaults) {
      setAssignmentConfig(assignmentDefaults);
    }
  };

  const onSubmit = async (raw: FormValues) => {
    try {
      if (assignmentMaxPointsInvalid || assignmentMaxSubmissionsInvalid) {
        showToast.error('Fix assignment settings before saving.');
        return;
      }

      // 1) Normalize with form schema
      const parsed: ParsedValues = ProblemFormSchema.parse(raw);

      // 2) Enforce update contract with id (file stays optional)
      const payload = UpdateProblemSchema.parse({ id: problem.id, ...parsed });

      const formData = new FormData();
      formData.append('title', payload.title ?? '');
      formData.append('description', payload.description ?? '');
      formData.append('type', payload.type ?? '');
      formData.append('courseId', payload.courseId ?? '');

      if (payload.type === 'FA' || payload.type === 'PDA') {
        const normalizedMax = payload.isUnlimited ? -1 : Number(payload.maxStates ?? 0);
        formData.append('maxStates', String(normalizedMax));
      }

      if (payload.type === 'FA') {
        formData.append('isDeterministic', String(!!payload.isDeterministic));
      }

      if (payload.file instanceof File) {
        formData.append('file', payload.file);
      }

      const res = await fetch(`/api/problems/${problem.id}`, {
        method: 'PUT',
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Edit problem error response:', errorText);

        let errorMessage = 'Failed to update problem.';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch {
          // Ignore parse failure
        }

        showToast.error(errorMessage);
        return;
      }

      const updatedProblem = await res.json().catch(() => null);

      if (assignmentSettings && assignmentDirty) {
        const assignmentRes = await fetch(
          `/api/courses/${assignmentSettings.courseId}/${assignmentSettings.assignmentId}/problems/${problem.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              maxPoints: Math.max(0, assignmentConfig.maxPoints),
              maxSubmissions: assignmentConfig.maxSubmissions,
              autograderEnabled: assignmentConfig.autograderEnabled,
            }),
          },
        );

        if (!assignmentRes.ok) {
          const assignmentErrorText = await assignmentRes.text();
          let assignmentMessage = 'Failed to update assignment settings.';
          try {
            const parsedError = JSON.parse(assignmentErrorText);
            assignmentMessage = parsedError.error || assignmentMessage;
          } catch {
            // Ignore parse failure
          }

          showToast.error(assignmentMessage);
          return;
        }
      }

      showToast.success('Problem updated.');
      resetForm();
      onSaved?.(updatedProblem ?? undefined);
      setOpen(false);
    } catch (error) {
      console.error('Edit problem submission error:', error);
      showToast.error('Failed to save problem changes.');
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
                  value={field.value ?? ''}
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
                      value: isUnlimited ? '' : String(Math.abs(field.value ?? 0) || ''),
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
                  accept=".txt,.fa,.pda,.cfg,.re,.jff"
                  onChange={(e) => field.onChange(e.target.files?.[0])}
                />
                {fileErrorMessage && (
                  <p className="mt-1 text-xs text-red-600">{fileErrorMessage}</p>
                )}
              </div>
            )}
          />

          {assignmentSettings ? (
            <div className="rounded-md border p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold">Assignment Settings</p>
                <p className="text-muted-foreground text-xs">
                  These limits apply only to this assignment.
                </p>
              </div>
              <div className="grid gap-4">
                <div>
                  <Label htmlFor="assignment-max-points" className="mb-2 block">
                    Max Points
                  </Label>
                  <Input
                    id="assignment-max-points"
                    type="number"
                    min={0}
                    step="0.5"
                    value={assignmentConfig.maxPoints}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setAssignmentConfig((prev) => ({
                        ...prev,
                        maxPoints: Number.isFinite(next) ? Math.max(0, next) : prev.maxPoints,
                      }));
                    }}
                  />
                  {Number.isFinite(assignmentConfig.maxPoints) && assignmentConfig.maxPoints < 0 ? (
                    <p className="mt-1 text-xs text-red-600">Max points must be 0 or greater.</p>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor="assignment-max-submissions" className="mb-2 block">
                    Max Submissions
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      id="assignment-max-submissions"
                      type="number"
                      min={1}
                      step="1"
                      value={
                        assignmentConfig.maxSubmissions === -1
                          ? ''
                          : assignmentConfig.maxSubmissions
                      }
                      disabled={assignmentConfig.maxSubmissions === -1}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        setAssignmentConfig((prev) => ({
                          ...prev,
                          maxSubmissions: Math.max(1, Math.floor(next)),
                        }));
                      }}
                      className="sm:flex-1"
                    />
                    <div className="flex items-center gap-2">
                      <Switch
                        id="assignment-unlimited-submissions"
                        checked={assignmentConfig.maxSubmissions === -1}
                        onCheckedChange={(checked) =>
                          setAssignmentConfig((prev) => ({
                            ...prev,
                            maxSubmissions: checked
                              ? -1
                              : Math.max(1, prev.maxSubmissions === -1 ? 1 : prev.maxSubmissions),
                          }))
                        }
                      />
                      <Label htmlFor="assignment-unlimited-submissions" className="text-sm">
                        Unlimited
                      </Label>
                    </div>
                  </div>
                  {assignmentConfig.maxSubmissions !== -1 && assignmentConfig.maxSubmissions < 1 ? (
                    <p className="mt-1 text-xs text-red-600">
                      Max submissions must be at least 1 or unlimited.
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold">Autograder</p>
                    <p className="text-muted-foreground text-xs">
                      Controls autograder behavior for this assignment only.
                    </p>
                  </div>
                  <Switch
                    id="assignment-autograder"
                    checked={assignmentConfig.autograderEnabled}
                    onCheckedChange={(checked) =>
                      setAssignmentConfig((prev) => ({
                        ...prev,
                        autograderEnabled: !!checked,
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={isSubmitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={
                !isValid ||
                isSubmitting ||
                courseIsArchived ||
                assignmentMaxPointsInvalid ||
                assignmentMaxSubmissionsInvalid ||
                (!isDirty && !assignmentDirty)
              }
              title={
                !isValid
                  ? 'Fix validation errors to save'
                  : assignmentMaxPointsInvalid || assignmentMaxSubmissionsInvalid
                    ? 'Fix assignment settings to save'
                    : !isDirty && !assignmentDirty
                      ? 'Make changes before saving'
                      : isSubmitting
                        ? 'Submitting...'
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
