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
  targetType?: 'STUDENT' | 'GROUP';
  userId: string | null;
  groupId?: string | null;
  unlockAt: string | null;
  dueDate: string | null;
  lateCutoff: string | null;
  allowLateSubmissions: boolean | null;
  user?: { firstName: string | null; lastName: string | null; email: string } | null;
  studentGroup?: { id: string; name: string; _count?: { memberships: number } } | null;
};

function overrideStudentName(u: OverrideApi['user']): string {
  return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || u?.email || 'Student';
}

/** A loaded override targets a group when it carries a groupId (or studentGroup payload). */
function isGroupOverride(o: OverrideApi): boolean {
  return !!(o.groupId ?? o.studentGroup?.id);
}

/** Diff key: student rows by user, group rows by group, so both kinds diff independently. */
function overrideKey(o: { userId?: string | null; groupId?: string | null }): string | null {
  if (o.groupId) return `g:${o.groupId}`;
  if (o.userId) return `s:${o.userId}`;
  return null;
}

type AssignmentWithUnlock = Assignment & {
  unlockAt?: Date | string | null;
  assignedToEveryone?: boolean;
  groupSetId?: string | null;
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
      courseId,
      groupSetId: assignment.groupSetId ?? null,
      overrides: loadedOverrides.map((o) =>
        isGroupOverride(o)
          ? {
              groupId: o.groupId ?? o.studentGroup?.id ?? '',
              groupName: o.studentGroup?.name ?? 'Group',
              groupMemberCount: o.studentGroup?._count?.memberships,
              unlockAt: toLocal(o.unlockAt),
              dueDate: toLocal(o.dueDate),
              allowLateSubmissions: o.allowLateSubmissions ?? undefined,
              lateCutoff: toLocal(o.lateCutoff),
            }
          : {
              userId: o.userId ?? '',
              studentName: overrideStudentName(o.user),
              unlockAt: toLocal(o.unlockAt),
              dueDate: toLocal(o.dueDate),
              allowLateSubmissions: o.allowLateSubmissions ?? undefined,
              lateCutoff: toLocal(o.lateCutoff),
            },
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      assignment.allowLateSubmissions,
      assignment.assignedToEveryone,
      assignment.description,
      assignment.dueDate,
      assignment.groupSetId,
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

    // 2. Diff the overrides against what was loaded. Both kinds of target are keyed so
    // they diff independently: student rows by `s:${userId}`, group rows by `g:${groupId}`.
    const origByKey = new Map<string, OverrideApi>();
    for (const o of loadedOverrides) {
      const key = overrideKey({ userId: o.userId, groupId: o.groupId ?? o.studentGroup?.id });
      if (key) origByKey.set(key, o);
    }
    type FormOverride = NonNullable<FormValues['overrides']>[number];
    const formByKey = new Map<string, FormOverride>();
    for (const o of raw.overrides ?? []) {
      const key = overrideKey(o);
      if (key) formByKey.set(key, o);
    }

    const ops: Promise<unknown>[] = [];
    for (const [key, orig] of origByKey) {
      if (!formByKey.has(key)) {
        ops.push(apiClient.del(apiPaths.assignmentOverride(courseId, assignment.id, orig.id)));
      }
    }
    for (const [key, o] of formByKey) {
      const body = {
        unlockAt: o.unlockAt || null,
        dueDate: o.dueDate || null,
        allowLateSubmissions: o.allowLateSubmissions ?? null,
        lateCutoff: o.allowLateSubmissions ? o.lateCutoff || null : null,
      };
      const orig = origByKey.get(key);
      if (orig) {
        // The target never changes on update, only the dates/late policy.
        ops.push(
          apiClient.patch(apiPaths.assignmentOverride(courseId, assignment.id, orig.id), body),
        );
      } else {
        // New target: send exactly one of a group or a student.
        const target = o.groupId ? { groupId: o.groupId } : { userId: o.userId };
        ops.push(
          apiClient.post(apiPaths.assignmentOverrides(courseId, assignment.id), {
            ...target,
            ...body,
          }),
        );
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
