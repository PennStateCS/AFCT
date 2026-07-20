'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { Assignment } from '@prisma/client';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AssignToFields } from '@/components/assignments/AssignToFields';
import { DateOverridesEditor } from '@/components/assignments/DateOverridesEditor';
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

type AssigneeApi = {
  id: string;
  targetType: 'STUDENT' | 'GROUP';
  userId: string | null;
  groupId: string | null;
  user?: { firstName: string | null; lastName: string | null; email: string } | null;
  studentGroup?: { id: string; name: string; _count?: { memberships: number } } | null;
};

type OverrideApi = {
  id: string;
  targetType: 'STUDENT' | 'GROUP';
  userId: string | null;
  groupId: string | null;
  unlockAt: string | null;
  dueDate: string | null;
  lateCutoff: string | null;
  allowLateSubmissions: boolean | null;
  user?: { firstName: string | null; lastName: string | null; email: string } | null;
  studentGroup?: { id: string; name: string; _count?: { memberships: number } } | null;
};

function personName(u: { firstName: string | null; lastName: string | null; email: string } | null | undefined): string {
  return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || u?.email || 'Student';
}

/** Diff key: student rows by user, group rows by group. */
function targetKey(o: { userId?: string | null; groupId?: string | null }): string | null {
  if (o.groupId) return `g:${o.groupId}`;
  if (o.userId) return `s:${o.userId}`;
  return null;
}

type FormValues = z.input<typeof AssignmentWizardFormSchema>;
type FormOverride = NonNullable<FormValues['dateOverrides']>[number];

/** A row carries a date exception when any deadline field is set (else it's a no-op). */
function hasDateException(o: FormOverride | undefined): boolean {
  if (!o) return false;
  return (
    !!o.unlockAt ||
    !!o.dueDate ||
    !!o.lateCutoff ||
    (o.allowLateSubmissions !== undefined && o.allowLateSubmissions !== null)
  );
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

/**
 * The assignment's Assign To tab. Reuses the create wizard's AssignToFields (the audience
 * selector + the default schedule) so create and edit look and behave the same, and adds a
 * per-student / per-group date-override editor. On save it PUTs the base schedule, PUTs the
 * audience (assignees), and diffs the date overrides (create / patch / delete).
 */
export function AssignmentSettingsCard({
  courseId,
  assignment,
  timeZone,
  courseIsArchived,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false);

  const assigneesQuery = useQuery({
    queryKey: ['course', courseId, 'assignment', assignment.id, 'assignees'],
    queryFn: () =>
      apiClient.get<AssigneeApi[]>(apiPaths.assignmentAssignees(courseId, assignment.id)),
    staleTime: 30_000,
  });
  const loadedAssignees = useMemo(() => assigneesQuery.data ?? [], [assigneesQuery.data]);

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
      isGroup: assignment.groupSetId != null,
      // Audience rows (dateless) AssignToFields drives; seeded from the current assignees.
      overrides: loadedAssignees.map((a) =>
        a.groupId
          ? {
              groupId: a.groupId,
              groupName: a.studentGroup?.name ?? 'Group',
              groupMemberCount: a.studentGroup?._count?.memberships,
            }
          : { userId: a.userId ?? '', studentName: personName(a.user) },
      ),
      // Date-exception rows the DateOverridesEditor drives; seeded from the loaded overrides.
      dateOverrides: loadedOverrides.map((o) =>
        o.groupId
          ? {
              groupId: o.groupId,
              groupName: o.studentGroup?.name ?? 'Group',
              groupMemberCount: o.studentGroup?._count?.memberships,
              unlockAt: toLocal(o.unlockAt),
              dueDate: toLocal(o.dueDate),
              lateCutoff: toLocal(o.lateCutoff),
              allowLateSubmissions: o.allowLateSubmissions ?? undefined,
            }
          : {
              userId: o.userId ?? '',
              studentName: personName(o.user),
              unlockAt: toLocal(o.unlockAt),
              dueDate: toLocal(o.dueDate),
              lateCutoff: toLocal(o.lateCutoff),
              allowLateSubmissions: o.allowLateSubmissions ?? undefined,
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
      loadedAssignees,
      loadedOverrides,
      timeZone,
    ],
  );

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isValid, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(AssignmentWizardFormSchema),
    defaultValues,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const doSave = async (raw: FormValues) => {
    setSaving(true);
    try {
      // 1. Base schedule only. Title/description/isPublished are owned by other UI (the
      // Details tab and the header Published switch), so this tab must not send them --
      // that would clobber a concurrent edit. The audience is the assignees PUT below.
      const updated = await apiClient.put<Assignment>(
        apiPaths.assignment(courseId, assignment.id),
        {
          unlockAt: raw.unlockAt || null,
          dueDate: raw.dueDate,
          allowLateSubmissions: raw.allowLateSubmissions,
          lateCutoff: raw.allowLateSubmissions ? raw.lateCutoff || null : null,
        },
      );
      // 2. Audience: everyone, or the explicit assignee list (also drops orphan overrides).
      await apiClient.put(apiPaths.assignmentAssignees(courseId, assignment.id), {
        assignedToEveryone: raw.assignedToEveryone,
        assignees: raw.assignedToEveryone
          ? []
          : (raw.overrides ?? []).map((o) => (o.groupId ? { groupId: o.groupId } : { userId: o.userId })),
      });
      // 3. Date overrides: diff against the loaded rows (create / patch / delete). Only
      // touch targets that are still assigned -- overrides for targets dropped from the
      // audience are owned (and already cleaned) by the assignees PUT above, so diffing them
      // here would just produce spurious 404/400s.
      const assignedKeys = raw.assignedToEveryone
        ? null // everyone -> every target is assigned
        : new Set(
            (raw.overrides ?? [])
              .map((o) => targetKey(o))
              .filter((k): k is string => !!k),
          );
      const isAssigned = (k: string) => assignedKeys === null || assignedKeys.has(k);

      const origByKey = new Map<string, OverrideApi>();
      for (const o of loadedOverrides) {
        const k = targetKey({ userId: o.userId, groupId: o.groupId ?? o.studentGroup?.id });
        if (k) origByKey.set(k, o);
      }
      const formByKey = new Map<string, FormOverride>();
      for (const o of raw.dateOverrides ?? []) {
        if (!hasDateException(o)) continue; // a blank row is a no-op (delete any prior override)
        const k = targetKey(o);
        if (k) formByKey.set(k, o);
      }
      const ops: Promise<unknown>[] = [];
      for (const [k, orig] of origByKey) {
        if (!formByKey.has(k) && isAssigned(k)) {
          ops.push(apiClient.del(apiPaths.assignmentOverride(courseId, assignment.id, orig.id)));
        }
      }
      for (const [k, o] of formByKey) {
        if (!isAssigned(k)) continue;
        const body = {
          unlockAt: o.unlockAt || null,
          dueDate: o.dueDate || null,
          allowLateSubmissions: o.allowLateSubmissions ?? null,
          lateCutoff: o.allowLateSubmissions ? o.lateCutoff || null : null,
        };
        const orig = origByKey.get(k);
        if (orig) {
          ops.push(apiClient.patch(apiPaths.assignmentOverride(courseId, assignment.id, orig.id), body));
        } else {
          ops.push(
            apiClient.post(apiPaths.assignmentOverrides(courseId, assignment.id), {
              ...(o.groupId ? { groupId: o.groupId } : { userId: o.userId }),
              ...body,
            }),
          );
        }
      }
      const failed = (await Promise.allSettled(ops)).filter((r) => r.status === 'rejected').length;

      if (failed > 0) {
        showToast.warning(`Saved, but ${failed} date override(s) could not be saved.`);
      } else {
        showToast.success('Assign To saved');
      }
      onSaved?.(updated);
      await Promise.all([assigneesQuery.refetch(), overridesQuery.refetch()]);
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 role="heading" aria-level={2} className="flex items-center gap-2 text-2xl font-semibold">
        <Users className="h-6 w-6" />
        Assign To
      </h2>
      <p className="text-muted-foreground max-w-3xl text-sm">
        Choose who this assignment is for, set the default schedule, and add date overrides for
        individual students or groups.
      </p>

      <form
        className="max-w-5xl space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit(doSave)(e);
        }}
      >
        <div className="max-w-3xl">
          <AssignToFields
            control={control}
            errors={errors}
            courseId={courseId}
            active
            hideOverridesHint
          />
        </div>

        <DateOverridesEditor control={control} courseId={courseId} active />

        <div className="flex max-w-3xl justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => reset(defaultValues)}
            disabled={!isDirty || saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!isDirty || !isValid || saving || courseIsArchived}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
