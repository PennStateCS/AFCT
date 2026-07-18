'use client';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { Assignment } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Settings } from 'lucide-react';
import SwitchField from '@/components/ui/SwitchField';
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';
import { AssignToFields } from '@/components/assignments/AssignToFields';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { AssignmentWizardFormSchema } from '@/schemas/assignment';

// Date -> "YYYY-MM-DDTHH:MM" for <input type="datetime-local"> in a timezone.
function toDateTimeLocalInTimeZone(date: Date | string, timeZone: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const l = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${l.year ?? '0000'}-${l.month ?? '01'}-${l.day ?? '01'}T${l.hour ?? '00'}:${l.minute ?? '00'}`;
}

type OverrideApi = {
  id: string;
  userId: string | null;
  unlockAt: string | null;
  dueDate: string | null;
  lateCutoff: string | null;
  allowLateSubmissions: boolean | null;
  user?: { firstName: string | null; lastName: string | null; email: string } | null;
};

function overrideStudentName(u: OverrideApi['user']): string {
  return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || u?.email || 'Student';
}

type AssignmentWithUnlock = Assignment & {
  unlockAt?: Date | string | null;
  assignedToEveryone?: boolean;
};

type Props = {
  courseId: string;
  assignment: AssignmentWithUnlock;
  timeZone: string;
  courseIsArchived: boolean;
  onSaved?: (updated: Assignment) => void;
};

type FormValues = z.input<typeof AssignmentWizardFormSchema>;

/**
 * The assignment's settings, edited in place on the assignment page's Settings tab. Covers
 * the base fields plus the full "Assign To" section (availability window, due date, late
 * policy, assign-to-everyone toggle, and per-student due-date overrides), reusing the same
 * AssignToFields as the create wizard. Saving PUTs the base and diffs the overrides
 * (create / update / delete) against what was loaded.
 */
export function AssignmentSettingsCard({
  courseId,
  assignment,
  timeZone,
  courseIsArchived,
  onSaved,
}: Props) {
  const overridesQuery = useQuery({
    queryKey: ['course', courseId, 'assignment', assignment.id, 'overrides'],
    queryFn: () =>
      apiClient.get<OverrideApi[]>(apiPaths.assignmentOverrides(courseId, assignment.id)),
    staleTime: 30_000,
  });
  const loadedOverrides = useMemo(() => overridesQuery.data ?? [], [overridesQuery.data]);

  const toLocal = (v: Date | string | null | undefined): string | undefined =>
    v ? toDateTimeLocalInTimeZone(v, timeZone) : undefined;

  const defaultValues: FormValues = useMemo(
    () => ({
      title: assignment.title ?? '',
      description: assignment.description ?? '',
      unlockAt: toLocal(assignment.unlockAt),
      dueDate: toDateTimeLocalInTimeZone(assignment.dueDate, timeZone),
      assignedToEveryone: assignment.assignedToEveryone ?? true,
      allowLateSubmissions: assignment.allowLateSubmissions ?? false,
      lateCutoff: toLocal(assignment.lateCutoff),
      isPublished: assignment.isPublished ?? false,
      isGroup: assignment.isGroup ?? false,
      courseId,
      overrides: loadedOverrides.map((o) => ({
        userId: o.userId ?? '',
        studentName: overrideStudentName(o.user),
        unlockAt: toLocal(o.unlockAt),
        dueDate: toLocal(o.dueDate),
        allowLateSubmissions: o.allowLateSubmissions ?? undefined,
        lateCutoff: toLocal(o.lateCutoff),
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      assignment.allowLateSubmissions,
      assignment.assignedToEveryone,
      assignment.description,
      assignment.dueDate,
      assignment.isGroup,
      assignment.isPublished,
      assignment.title,
      assignment.unlockAt,
      courseId,
      loadedOverrides,
      timeZone,
    ],
  );

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isValid, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(AssignmentWizardFormSchema),
    defaultValues,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  // Re-seed when the assignment or its loaded overrides change (e.g. after a save refetch).
  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const onSubmit = async (raw: FormValues) => {
    // 1. Save the base assignment fields.
    const basePayload = {
      title: raw.title,
      description: raw.description ?? '',
      unlockAt: raw.unlockAt || null,
      dueDate: raw.dueDate,
      assignedToEveryone: raw.assignedToEveryone,
      allowLateSubmissions: raw.allowLateSubmissions,
      lateCutoff: raw.allowLateSubmissions ? raw.lateCutoff || null : null,
      isPublished: raw.isPublished,
      isGroup: raw.isGroup,
    };
    let updated: Assignment;
    try {
      updated = await apiClient.put<Assignment>(
        apiPaths.assignment(courseId, assignment.id),
        basePayload,
      );
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to save settings');
      return;
    }

    // 2. Diff the per-student overrides against what was loaded (keyed by student).
    const origByUser = new Map(
      loadedOverrides.filter((o) => o.userId).map((o) => [o.userId as string, o]),
    );
    const formByUser = new Map((raw.overrides ?? []).map((o) => [o.userId, o]));

    const ops: Promise<unknown>[] = [];
    for (const [userId, orig] of origByUser) {
      if (!formByUser.has(userId)) {
        ops.push(apiClient.del(apiPaths.assignmentOverride(courseId, assignment.id, orig.id)));
      }
    }
    for (const [userId, o] of formByUser) {
      const body = {
        unlockAt: o.unlockAt || null,
        dueDate: o.dueDate || null,
        allowLateSubmissions: o.allowLateSubmissions ?? null,
        lateCutoff: o.allowLateSubmissions ? o.lateCutoff || null : null,
      };
      const orig = origByUser.get(userId);
      if (orig) {
        ops.push(
          apiClient.patch(apiPaths.assignmentOverride(courseId, assignment.id, orig.id), body),
        );
      } else {
        ops.push(apiClient.post(apiPaths.assignmentOverrides(courseId, assignment.id), { userId, ...body }));
      }
    }
    const failed = (await Promise.allSettled(ops)).filter((r) => r.status === 'rejected').length;

    await overridesQuery.refetch();
    if (failed > 0) {
      showToast.warning(`Settings saved, but ${failed} due-date change(s) could not be saved.`);
    } else {
      showToast.success('Assignment settings saved');
    }
    onSaved?.(updated);
  };

  return (
    <div className="space-y-4">
      <h2 role="heading" aria-level={2} className="flex items-center gap-2 text-2xl font-semibold">
        <Settings className="h-6 w-6" />
        Settings
      </h2>
      <form
        className="max-w-2xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit((data) => onSubmit(data as unknown as FormValues))(e);
        }}
      >
        <Controller
          name="title"
          control={control}
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
          name="description"
          control={control}
          render={({ field }) => (
            <div>
              <Label htmlFor="settings-description" className="mb-2 block">
                Description
              </Label>
              <Textarea
                {...field}
                id="settings-description"
                value={field.value ?? ''}
                placeholder="Enter assignment description"
                className="min-h-[100px]"
              />
              {errors.description && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  {errors.description.message}
                </p>
              )}
            </div>
          )}
        />

        <AssignToFields control={control} errors={errors} courseId={courseId} active />

        <Controller
          name="isGroup"
          control={control}
          render={({ field }) => (
            <SwitchField
              label="Group Assignment"
              name="isGroup"
              checked={!!field.value}
              onCheckedChange={(checked) => field.onChange(!!checked)}
              description="Students submit and are graded as groups for this assignment."
              descriptionPlacement="inline"
            />
          )}
        />

        <Controller
          name="isPublished"
          control={control}
          render={({ field }) => (
            <SwitchField
              label="Published"
              name="isPublished"
              checked={!!field.value}
              onCheckedChange={(checked) => field.onChange(!!checked)}
              description="Makes the assignment visible to enrolled students."
              descriptionPlacement="inline"
            />
          )}
        />

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!isValid || isSubmitting || courseIsArchived || !isDirty}
            title={courseIsArchived ? 'Course is archived' : undefined}
          >
            {isSubmitting ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
