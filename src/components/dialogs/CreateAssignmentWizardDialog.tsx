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
import SelectField from '@/components/ui/SelectField';
import { Textarea } from '@/components/ui/textarea';
import { AssignToFields } from '@/components/assignments/AssignToFields';
import { toast } from 'sonner';

import { useForm, Controller, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { AssignmentWizardFormSchema } from '@/schemas/assignment';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import type { GroupSetSummaryDTO } from '@/lib/group-set-service';
import type { Assignment } from '@prisma/client';

type FormValues = z.input<typeof AssignmentWizardFormSchema>;

const STEPS: ReadonlyArray<{ title: string; fields: FieldPath<FormValues>[] }> = [
  { title: 'Details', fields: ['title', 'description'] },
  { title: 'Type', fields: ['isGroup', 'groupSetId'] },
  {
    title: 'Assign To',
    fields: ['assignedToEveryone', 'unlockAt', 'dueDate', 'allowLateSubmissions', 'lateCutoff', 'overrides'],
  },
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
      // Assignments are created unpublished for now; staff publish them later.
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
    setValue,
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
  const isGroup = watch('isGroup');

  // Group sets for the course, so the Type step can offer one to pin group work to. Shares
  // the ['course', id, 'group-sets'] cache with AssignToFields (step 3), so they dedupe.
  const groupSetsQuery = useQuery({
    queryKey: ['course', courseId, 'group-sets'],
    queryFn: () => apiClient.get<GroupSetSummaryDTO[]>(apiPaths.courseGroupSets(courseId)),
    enabled: open && !!courseId,
    staleTime: 30_000,
  });
  const groupSets = groupSetsQuery.data ?? [];

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
      isGroup: raw.isGroup,
      // Always created unpublished for now; there is no publish step.
      isPublished: false,
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
          // A row targets exactly one of a student or a group.
          ...(o.groupId ? { groupId: o.groupId } : { userId: o.userId }),
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
  const reviewGroupSetName = groupSets.find((s) => s.id === review?.groupSetId)?.name;
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
            Create an assignment in four steps: details, individual or group type, who it is
            assigned to and when it is due, then review.
          </DialogDescription>
        </DialogHeader>

        <Stepper
          steps={STEPS.map((s) => s.title)}
          current={step}
          onStepClick={(index) => setStep(index)}
          className="mb-2"
        />

        {/* Announce step changes to screen readers (the Stepper is visual). */}
        <div className="sr-only" role="status" aria-live="polite">
          {`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]?.title ?? ''}`}
        </div>

        <form
          onSubmit={step === LAST_STEP ? handleSubmit(onSubmit) : (e) => e.preventDefault()}
          className="space-y-4"
          onKeyDown={(e) => {
            // Enter advances the wizard from a single-line field, but must not do so from
            // a textarea (where Enter inserts a newline) or any editable rich control.
            const el = e.target as HTMLElement;
            const isMultiline = el.tagName === 'TEXTAREA' || el.isContentEditable;
            if (e.key === 'Enter' && step < LAST_STEP && !isMultiline) {
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
              <div className="space-y-5">
              <Controller
                control={control}
                name="isGroup"
                render={({ field }) => (
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-medium">Assignment type</legend>
                    <p className="text-muted-foreground text-sm">
                      Choose whether students complete this assignment on their own or together as a
                      group.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(
                        [
                          {
                            value: false,
                            label: 'Individual',
                            desc: 'Each student submits and is graded on their own.',
                          },
                          {
                            value: true,
                            label: 'Group',
                            desc: 'Students submit and are graded together as a group. A faculty member or TA can override an individual member’s grade.',
                          },
                        ] as const
                      ).map((opt) => {
                        const selected = !!field.value === opt.value;
                        return (
                          <label
                            key={opt.label}
                            className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition ${
                              selected
                                ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                                : 'hover:bg-muted/40'
                            }`}
                          >
                            <input
                              type="radio"
                              name="isGroup"
                              className="accent-primary mt-1"
                              checked={selected}
                              onChange={() => {
                                field.onChange(opt.value);
                                // Switching back to Individual drops any chosen group set.
                                if (!opt.value) setValue('groupSetId', null, { shouldValidate: true });
                              }}
                            />
                            <span>
                              <span className="block text-sm font-medium">{opt.label}</span>
                              <span className="text-muted-foreground block text-xs">{opt.desc}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              />

              {/* Group assignments pick which group set they run in. Not stored on the
                  assignment itself; the Assign-To step (3) uses this selection. */}
              {isGroup && (
                <Controller
                  control={control}
                  name="groupSetId"
                  render={({ field }) => (
                    <div className="space-y-1">
                      {groupSetsQuery.isPending ? (
                        <p className="text-muted-foreground text-sm">Loading group sets…</p>
                      ) : groupSets.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          This course has no group sets yet. Create one on the course&apos;s Groups
                          tab first.
                        </p>
                      ) : (
                        <SelectField
                          label="Group set"
                          name="groupSetId"
                          placeholder="Choose a group set"
                          description="Students submit and are graded as their group in the chosen set."
                          value={field.value ?? undefined}
                          onValueChange={(v) => field.onChange(v)}
                          triggerClassName="bg-card border-black"
                          options={groupSets.map((gs) => ({
                            value: gs.id,
                            label: `${gs.name} (${gs.groupCount} ${gs.groupCount === 1 ? 'group' : 'groups'})`,
                          }))}
                        />
                      )}
                      {errors.groupSetId && (
                        <p className="text-xs text-red-600" role="alert">
                          {errors.groupSetId.message}
                        </p>
                      )}
                    </div>
                  )}
                />
              )}
              </div>
            )}

            {step === 2 && (
              <AssignToFields control={control} errors={errors} courseId={courseId} active={open} />
            )}

            {step === LAST_STEP && review && (
              <div className="space-y-3">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm [&>dd]:min-w-0 [&>dd]:break-words">
                  <dt className="text-muted-foreground">Title</dt>
                  <dd className="font-medium">{review.title}</dd>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd>
                    {review.isGroup
                      ? `Group${reviewGroupSetName ? ` · ${reviewGroupSetName}` : ''}`
                      : 'Individual'}
                  </dd>
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
                        <dt className="text-muted-foreground">
                          {o.groupId ? o.groupName : o.studentName}
                        </dt>
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
                </dl>
                <p className="text-muted-foreground text-xs">
                  Created unpublished. Add problems and publish it after creating it.
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
