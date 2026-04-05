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
      maxSubmissions: typeof problem.maxSubmissions === 'number' ? problem.maxSubmissions : 1,
      isUnlimitedSubmissions:
        typeof problem.maxSubmissions === 'number' ? problem.maxSubmissions < 0 : false,
      maxPoints: typeof problem.maxPoints === 'number' ? problem.maxPoints : 1,
      type: problem.type as z.infer<typeof ProblemTypeEnum>,
      isUnlimitedStates: problem.maxStates == null || problem.maxStates < 0,
      maxStates: problem.maxStates ?? undefined,
      isDeterministic:
        problem.type === 'FA'
          ? !!(problem as Problem & { isDeterministic?: boolean }).isDeterministic
          : false,
      autograderEnabled:
        (problem as Problem & { autograderEnabled?: boolean }).autograderEnabled ?? true,
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
    setError,
    formState: { errors, isSubmitting, isValid, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(ProblemFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  // Drive conditional UI
  const type = watch('type');
  const isUnlimitedStates = watch('isUnlimitedStates');
  const isUnlimitedSubmissions = watch('isUnlimitedSubmissions');

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
      } else {
        setAssignmentConfig({
          maxPoints: assignmentSettings?.maxPoints ?? 0,
          maxSubmissions: assignmentSettings?.maxSubmissions ?? -1,
          autograderEnabled: assignmentSettings?.autograderEnabled ?? true,
        });
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
      } else {
        setAssignmentConfig({
          maxPoints: assignmentSettings?.maxPoints ?? 0,
          maxSubmissions: assignmentSettings?.maxSubmissions ?? -1,
          autograderEnabled: assignmentSettings?.autograderEnabled ?? true,
        });
      }
    }
  }, [open, defaults, reset, assignmentDefaults, assignmentSettings]);

  const resetForm = () => {
    reset(defaults, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });
    if (assignmentDefaults) {
      setAssignmentConfig(assignmentDefaults);
    } else {
      setAssignmentConfig({
        maxPoints: assignmentSettings?.maxPoints ?? 0,
        maxSubmissions: assignmentSettings?.maxSubmissions ?? -1,
        autograderEnabled: assignmentSettings?.autograderEnabled ?? true,
      });
    }
  };

  const onSubmit = async (raw: FormValues) => {
    try {
      if (assignmentMaxSubmissionsInvalid || assignmentMaxPointsInvalid) {
        showToast.error('Fix assignment settings before saving.');
        return;
      }

      // 1) Normalize with form schema
      const parsed: ParsedValues = ProblemFormSchema.parse(raw);

      // 2) Enforce update contract with id (file stays optional)
      const payload = UpdateProblemSchema.parse({ id: problem.id, ...parsed });

      const effectiveMaxSubmissions = assignmentSettings
        ? assignmentConfig.maxSubmissions
        : payload.isUnlimitedSubmissions
          ? -1
          : (payload.maxSubmissions ?? 0);
      const effectiveMaxPoints = assignmentSettings
        ? assignmentConfig.maxPoints
        : (payload.maxPoints ?? 0);

      const formData = new FormData();
      formData.append('title', payload.title ?? '');
      formData.append('description', payload.description ?? '');
      formData.append('type', payload.type ?? '');
      formData.append('maxSubmissions', String(effectiveMaxSubmissions));
      formData.append('maxPoints', String(effectiveMaxPoints));
      formData.append('autograderEnabled', String(payload.autograderEnabled));
      formData.append('courseId', payload.courseId ?? '');

      if (payload.type === 'FA' || payload.type === 'PDA') {
        const normalizedMax = payload.isUnlimitedStates ? -1 : Number(payload.maxStates ?? 0);
        formData.append('maxStates', String(normalizedMax));
      }

      if (payload.type === 'FA') {
        formData.append('isDeterministic', String(!!payload.isDeterministic));
      }

      if (payload.type !== problem.type && !(payload.file instanceof File)) {
        setError('file', { type: 'manual', message: 'Upload a new solution file' });
        return;
      }

      // Include file ONLY if user selected a new one
      if (payload.file instanceof File) {
        formData.append('file', payload.file);
        await new Promise<void>((resolve, reject) => {
          const reader = new FileReader();

          reader.onload = function (e) {
            const parser = new DOMParser();
            const jff = parser.parseFromString(String(e.target?.result ?? ''), 'text/xml');

            if (jff.querySelector('parseerror')) {
              reject('JFF file not a valid XML');
              return;
            }

            const rawType = (jff.querySelector('type')?.textContent || '').toUpperCase();

            if (rawType !== (payload.type === 'CFG' ? 'GRAMMAR' : payload.type)) {
              reject(`The JFF file must be of type ${payload.type}`);
              return;
            }

            resolve();
          };

          reader.onerror = () => reject('Error reading file');

          reader.readAsText(payload.file);
        });
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
        const assignmentMaxPoints = Math.max(0, assignmentConfig.maxPoints ?? 0);
        const assignmentRes = await fetch(
          `/api/courses/${assignmentSettings.courseId}/${assignmentSettings.assignmentId}/problems/${problem.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              maxPoints: assignmentMaxPoints,
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

      resetForm();
      onSaved?.(updatedProblem ?? undefined);
      setOpen(false);
    } catch (error) {
      console.error('Edit problem submission error:', error);

      if (typeof error === 'string') {
        setError('file', { type: 'manual', message: error });
        return;
      }

      if (error instanceof z.ZodError) {
        showToast.error('Please fix validation errors before saving.');
        return;
      }

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

          {assignmentSettings ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="assignment-max-points" className="mb-2 block">
                    Max Points
                  </Label>
                  <Input
                    id="assignment-max-points"
                    type="number"
                    min={0}
                    step="1"
                    value={assignmentConfig.maxPoints ?? 0}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      setAssignmentConfig((prev) => ({
                        ...prev,
                        maxPoints: Math.max(0, Math.floor(next)),
                      }));
                    }}
                    className="sm:flex-1"
                  />
                  {assignmentMaxPointsInvalid ? (
                    <p className="mt-1 text-xs text-red-600">Max points must be zero or greater.</p>
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
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="assignment-automatic-grading" className="text-sm font-semibold">
                    Automatic Grading
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Controls automatic grading for this assignment only.
                  </p>
                </div>
                <Switch
                  id="assignment-automatic-grading"
                  checked={assignmentConfig.autograderEnabled}
                  onCheckedChange={(checked) =>
                    setAssignmentConfig((prev) => ({
                      ...prev,
                      autograderEnabled: !!checked,
                    }))
                  }
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Max Submissions */}
                <Controller
                  control={control}
                  name="maxSubmissions"
                  render={({ field }) => (
                    <div>
                      <InputGroup
                        label="Problem Max Submissions"
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
                        label="Problem Max Points"
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
              </div>

              {/* Automatic Grading */}
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
            </>
          )}

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
                      value: isUnlimitedStates ? '' : String(Math.abs(field.value ?? 0) || ''),
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                        field.onChange(e.target.value),
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
                  {problem.type === type ? 'Replace Answer File (optional)' : 'Replace Answer File'}
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
                assignmentMaxSubmissionsInvalid
              }
              title={
                !isValid
                  ? 'Fix validation errors to save'
                  : assignmentMaxPointsInvalid
                    ? 'Fix assignment settings to save'
                    : assignmentMaxSubmissionsInvalid
                      ? 'Fix assignment settings to save'
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
