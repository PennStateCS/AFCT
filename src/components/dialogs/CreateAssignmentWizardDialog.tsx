'use client';

import React, { useMemo, useState } from 'react';
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
import { Stepper } from '@/components/ui/stepper';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';
import { Textarea } from '@/components/ui/textarea';
import { AssignToFields } from '@/components/assignments/AssignToFields';
import { toast } from 'sonner';

import { useForm, Controller, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { AssignmentWizardFormSchema } from '@/schemas/assignment';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import type { Assignment } from '@prisma/client';

type FormValues = z.input<typeof AssignmentWizardFormSchema>;

const STEPS: ReadonlyArray<{ title: string; fields: FieldPath<FormValues>[] }> = [
  { title: 'Details', fields: ['title', 'description'] },
  {
    title: 'Assign To',
    fields: ['assignedToEveryone', 'unlockAt', 'dueDate', 'allowLateSubmissions', 'lateCutoff', 'overrides'],
  },
  { title: 'Options', fields: ['isPublished', 'isGroup'] },
  { title: 'Review', fields: [] },
];
const LAST_STEP = STEPS.length - 1;

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  timeZone: string;
  onCreate?: (assignment: Assignment) => void;
};

/** "today at 23:59" in the course timezone, the default base due date. */
function defaultDueLocalString(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const l = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${l.year ?? '0000'}-${l.month ?? '01'}-${l.day ?? '01'}T23:59`;
}

/** Render a datetime-local string ("2026-01-10T23:59") as "2026-01-10 23:59". */
function formatLocal(value: string | undefined | null): string {
  return value ? value.replace('T', ' ') : '';
}

/**
 * A full, human-readable window ("Available … · Due … · Late until …" / "· No late") from
 * already-resolved (effective) datetime-local strings. Used in Review so a target that
 * only changes the late policy still reads clearly.
 */
function formatWindow(w: {
  unlockAt?: string;
  dueDate?: string;
  allowLate?: boolean;
  lateCutoff?: string;
}): string {
  const parts: string[] = [];
  if (w.unlockAt) parts.push(`Available ${formatLocal(w.unlockAt)}`);
  parts.push(`Due ${w.dueDate ? formatLocal(w.dueDate) : 'not set'}`);
  if (w.allowLate) {
    parts.push(w.lateCutoff ? `Late until ${formatLocal(w.lateCutoff)}` : 'Late accepted');
  } else {
    parts.push('No late');
  }
  return parts.join(' · ');
}

export function CreateAssignmentWizardDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  timeZone,
  onCreate,
}: Props) {
  const [step, setStep] = useState(0);

  const defaults: FormValues = useMemo(
    () => ({
      title: '',
      description: '',
      unlockAt: undefined,
      dueDate: defaultDueLocalString(timeZone),
      assignedToEveryone: true,
      allowLateSubmissions: false,
      lateCutoff: undefined,
      isPublished: false,
      isGroup: false,
      courseId,
      overrides: [],
    }),
    [courseId, timeZone],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    trigger,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(AssignmentWizardFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  // The Assign-To fields (base dates + per-student overrides) live in AssignToFields; the
  // Review step still reads these two to summarize what was chosen.
  const assignedToEveryone = watch('assignedToEveryone');
  const overrides = watch('overrides') ?? [];

  const resetForm = () => {
    setStep(0);
    reset(defaults, { keepValues: false, keepErrors: false, keepDirty: false, keepTouched: false });
  };

  const next = async () => {
    const ok = await trigger(STEPS[step]?.fields ?? []);
    if (ok) setStep((s) => Math.min(s + 1, LAST_STEP));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (raw: FormValues) => {
    const basePayload = {
      title: raw.title,
      description: raw.description || undefined,
      dueDate: raw.dueDate,
      unlockAt: raw.unlockAt || undefined,
      assignedToEveryone: raw.assignedToEveryone,
      allowLateSubmissions: raw.allowLateSubmissions,
      lateCutoff: raw.allowLateSubmissions ? raw.lateCutoff : null,
      isPublished: raw.isPublished,
      isGroup: raw.isGroup,
    };

    let created: Assignment;
    try {
      created = await apiClient.post<Assignment>(apiPaths.courseAssignments(courseId), basePayload);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create assignment');
      return; // stay open so the user can retry without duplicating anything
    }

    // The assignment exists now; push the overrides. A failure here doesn't undo the
    // assignment (it can be edited later), so warn rather than error.
    const results = await Promise.allSettled(
      (raw.overrides ?? []).map((o) =>
        apiClient.post(apiPaths.assignmentOverrides(courseId, created.id), {
          userId: o.userId,
          unlockAt: o.unlockAt || undefined,
          dueDate: o.dueDate || undefined,
          allowLateSubmissions: o.allowLateSubmissions ?? undefined,
          lateCutoff: o.allowLateSubmissions ? o.lateCutoff || undefined : undefined,
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      toast.warning(`Assignment created, but ${failed} override(s) could not be saved.`);
    } else {
      toast.success('Assignment created');
    }

    onCreate?.(created);
    resetForm();
    setOpen(false);
  };

  const review = step === LAST_STEP ? getValues() : null;
  const everyoneLabel = !assignedToEveryone
    ? 'Default dates'
    : overrides.length > 0
      ? 'Everyone else'
      : 'Everyone';

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm();
      }}
    >
      <DialogContent className="bg-card sm:max-w-3xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Create Assignment</DialogTitle>
          <DialogDescription className="sr-only">
            Create an assignment in four steps: details, who it is assigned to and when it is due,
            options, then review.
          </DialogDescription>
        </DialogHeader>

        <Stepper
          steps={STEPS.map((s) => s.title)}
          current={step}
          onStepClick={(index) => setStep(index)}
          className="mb-2"
        />

        <form
          onSubmit={step === LAST_STEP ? handleSubmit(onSubmit) : (e) => e.preventDefault()}
          className="space-y-4"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && step < LAST_STEP) {
              e.preventDefault();
              void next();
            }
          }}
        >
          <div className="min-h-[320px] space-y-4">
            {step === 0 && (
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
                      <Label htmlFor="assignment-description" className="mb-2 block">
                        Description
                      </Label>
                      <Textarea
                        {...field}
                        id="assignment-description"
                        value={field.value ?? ''}
                        placeholder="Enter assignment description"
                        className="min-h-[120px]"
                      />
                      {errors.description && (
                        <p className="mt-1 text-xs text-red-600" role="alert">
                          {errors.description.message}
                        </p>
                      )}
                    </div>
                  )}
                />
              </>
            )}

            {step === 1 && (
              <AssignToFields control={control} errors={errors} courseId={courseId} active={open} />
            )}

            {step === 2 && (
              <>
                <Controller
                  control={control}
                  name="isPublished"
                  render={({ field }) => (
                    <SwitchField
                      label="Publish now"
                      name="isPublished"
                      checked={!!field.value}
                      onCheckedChange={(checked) => field.onChange(!!checked)}
                      description="Makes the assignment visible to enrolled students."
                      descriptionPlacement="inline"
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="isGroup"
                  render={({ field }) => (
                    <SwitchField
                      label="Group assignment"
                      name="isGroup"
                      checked={!!field.value}
                      onCheckedChange={(checked) => field.onChange(!!checked)}
                      description="Students submit and are graded as groups. Per-student overrides still target individuals."
                      descriptionPlacement="inline"
                    />
                  )}
                />
              </>
            )}

            {step === LAST_STEP && review && (
              <div className="space-y-3">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm [&>dd]:min-w-0 [&>dd]:break-words">
                  <dt className="text-muted-foreground">Title</dt>
                  <dd className="font-medium">{review.title}</dd>
                  <dt className="text-muted-foreground">{everyoneLabel}</dt>
                  <dd>
                    {formatWindow({
                      unlockAt: review.unlockAt,
                      dueDate: review.dueDate,
                      allowLate: review.allowLateSubmissions,
                      lateCutoff: review.lateCutoff,
                    })}
                  </dd>
                  {(review.overrides ?? []).map((o, i) => {
                    // Resolve each override against the base so a partial change (e.g. same
                    // due date but late now allowed) shows its full effective window.
                    const effAllow = o.allowLateSubmissions ?? review.allowLateSubmissions;
                    return (
                      <React.Fragment key={i}>
                        <dt className="text-muted-foreground">{o.studentName}</dt>
                        <dd>
                          {formatWindow({
                            unlockAt: o.unlockAt || review.unlockAt,
                            dueDate: o.dueDate || review.dueDate,
                            allowLate: effAllow,
                            lateCutoff: effAllow ? o.lateCutoff || review.lateCutoff : undefined,
                          })}
                        </dd>
                      </React.Fragment>
                    );
                  })}
                  <dt className="text-muted-foreground">Publish</dt>
                  <dd>{review.isPublished ? 'Now' : 'Later'}</dd>
                </dl>
                <p className="text-muted-foreground text-xs">
                  Add problems to the assignment after creating it.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            </DialogClose>

            {step > 0 && (
              <Button type="button" variant="secondary" onClick={back}>
                Back
              </Button>
            )}

            {step < LAST_STEP ? (
              <Button key="wizard-next" type="button" onClick={() => void next()}>
                Next
              </Button>
            ) : (
              <Button key="wizard-create" type="submit" disabled={isSubmitting || courseIsArchived}>
                {isSubmitting ? 'Creating…' : 'Create Assignment'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
