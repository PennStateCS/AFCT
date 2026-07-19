'use client';

import React, { useEffect, useId, useState } from 'react';
import {
  Controller,
  useController,
  useFieldArray,
  useWatch,
  type Control,
  type FieldErrors,
} from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import SwitchField from '@/components/ui/SwitchField';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { AudienceSelect, type AudienceItem } from '@/components/assignments/AudienceSelect';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CourseDateTimeField } from '@/components/dialogs/CourseDateTimeField';
import {
  useRosterStudentOptions,
  getStudentName,
} from '@/components/dialogs/useRosterStudentOptions';
import { apiClient } from '@/lib/api/fetch-client';
import { apiPaths } from '@/lib/api-paths';
import type { GroupSetDetailDTO } from '@/lib/group-set-service';
import { CalendarClock, CalendarRange, ChevronDown, Users, X } from 'lucide-react';
import type { AssignmentWizardFormSchema } from '@/schemas/assignment';
import {
  DueDateSection,
  OverrideLatePolicyField,
} from '@/components/assignments/DueDateFormPrimitives';

type FormValues = z.input<typeof AssignmentWizardFormSchema>;
type FormOverride = NonNullable<FormValues['overrides']>[number];

/** Render a datetime-local string ("2026-01-10T23:59") as "2026-01-10 23:59". */
function formatLocal(value: string | undefined | null): string {
  return value ? value.replace('T', ' ') : '';
}

/** "3 members" / "1 member" for a group summary. */
function memberCountLabel(count: number | undefined): string {
  const n = count ?? 0;
  return `${n} ${n === 1 ? 'member' : 'members'}`;
}

/** Diff key: student rows by user, group rows by group, so both kinds are keyed distinctly. */
function overrideKey(o: { userId?: string | null; groupId?: string | null }): string | null {
  if (o.groupId) return `g:${o.groupId}`;
  if (o.userId) return `s:${o.userId}`;
  return null;
}

/** A row carries a date exception when any deadline field is set (else it's audience-only). */
function hasDateException(o: FormOverride | undefined): boolean {
  if (!o) return false;
  return (
    !!o.unlockAt ||
    !!o.dueDate ||
    !!o.lateCutoff ||
    (o.allowLateSubmissions !== undefined && o.allowLateSubmissions !== null)
  );
}

/**
 * The create wizard's "Assign To" step. Mirrors the assignment Settings tab's Due Date(s)
 * layout with three stacked sections:
 *   1. Assignment audience: the "assign to everyone" toggle, and (when off) searchable
 *      student + group selectors. Audience membership is an override ROW; date exceptions
 *      are the same rows with dates set, so the two are separated presentationally only.
 *   2. Default dates: the base availability window, due date, and late policy.
 *   3. Date overrides: a compact, expandable list of rows that carry a date exception.
 *
 * A PURE react-hook-form component: it operates on the enclosing form (fields:
 * assignedToEveryone, unlockAt, dueDate, allowLateSubmissions, lateCutoff, groupSetId,
 * overrides) via useFieldArray/useWatch/useController and does no API save of its own. The
 * wizard collects the form values and POSTs them on create. `active` gates the roster and
 * group-set fetches.
 */
export function AssignToFields({
  control,
  errors,
  courseId,
  active,
}: {
  control: Control<FormValues>;
  errors: FieldErrors<FormValues>;
  courseId: string;
  active: boolean;
}) {
  const { fields, append, remove, update, replace } = useFieldArray({ control, name: 'overrides' });
  const { field: assignedToEveryoneField } = useController({ control, name: 'assignedToEveryone' });
  const sectionIdPrefix = useId();
  const regionHeadingId = `${sectionIdPrefix}-assign-to`;
  const audienceHeadingId = `${sectionIdPrefix}-audience`;
  const defaultDatesHeadingId = `${sectionIdPrefix}-default-dates`;
  const overridesHeadingId = `${sectionIdPrefix}-overrides`;
  const addOverrideId = `${sectionIdPrefix}-add-override`;
  const overrideTriggerId = (key: string) =>
    `${sectionIdPrefix}-override-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  // Rows the user has designated as date overrides this session (so a freshly-added one
  // shows in the list before any date is typed). Rows with dates show on their own.
  const [dateOverrideKeys, setDateOverrideKeys] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [focusTargetId, setFocusTargetId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');

  useEffect(() => {
    if (!focusTargetId) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(focusTargetId)?.focus();
      setFocusTargetId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [fields, focusTargetId]);

  const baseAllowLate = useWatch({ control, name: 'allowLateSubmissions' });
  const baseDue = useWatch({ control, name: 'dueDate' });
  const assignedToEveryone = useWatch({ control, name: 'assignedToEveryone' });
  // Individual vs group assignment (chosen in the wizard's Type step). Drives whether the
  // audience selector lists students or groups.
  const isGroup = !!useWatch({ control, name: 'isGroup' });
  const overrides = (useWatch({ control, name: 'overrides' }) ?? []) as FormOverride[];

  // The selected group set lives in the form so the wizard can pin it after creation.
  const { field: groupSetField } = useController({ control, name: 'groupSetId' });
  const groupSetId = groupSetField.value ?? '';

  const students = useRosterStudentOptions(courseId, active);

  // The chosen group set (from the Type step) and the groups within it.
  const groupSetDetailQuery = useQuery({
    queryKey: ['course', courseId, 'group-set', groupSetId],
    queryFn: () => apiClient.get<GroupSetDetailDTO>(apiPaths.courseGroupSet(courseId, groupSetId)),
    enabled: active && !!groupSetId,
    staleTime: 30_000,
  });
  const groups = groupSetDetailQuery.data?.groups ?? [];
  const groupMemberIdsById = new Map<string, string[]>();
  for (const g of groups)
    groupMemberIdsById.set(
      g.id,
      g.members.map((m) => m.id),
    );

  // ── Session state helpers ────────────────────────────────────────────────
  const clearSessionKey = (key: string) => {
    setDateOverrideKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setExpandedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const markDateOverride = (key: string) => {
    setDateOverrideKeys((prev) => new Set(prev).add(key));
    setExpandedKeys((prev) => new Set(prev).add(key));
  };

  const toggleExpanded = (key: string, open: boolean) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  // ── Audience selectors (everyone off) ────────────────────────────────────
  const studentRows = fields.filter((f) => !!f.userId);
  const groupRows = fields.filter((f) => !!f.groupId);

  // ── Date-override list (rows carrying a date exception, or session-added) ──
  const isShownOverride = (f: (typeof fields)[number], o: FormOverride | undefined): boolean => {
    const key = overrideKey({ userId: f.userId, groupId: f.groupId });
    return hasDateException(o) || (key ? dateOverrideKeys.has(key) : false);
  };

  const overrideRows = fields
    .map((f, index) => ({ f, index, o: overrides[index] }))
    .filter(({ f, o }) => isShownOverride(f, o))
    .sort((a, b) => {
      const an = a.f.groupId ? (a.f.groupName ?? '') : (a.f.studentName ?? '');
      const bn = b.f.groupId ? (b.f.groupName ?? '') : (b.f.studentName ?? '');
      return an.localeCompare(bn);
    });


  // The audience selector operates on students (individual) or groups (group). Members held
  // out as a date exception are auto-removed from it (they appear in the overrides list).
  const allMembers: AudienceItem[] = isGroup
    ? groups.map((g) => ({ id: g.id, label: `${g.name} (${memberCountLabel(g.members.length)})` }))
    : students.map((s) => ({ id: s.id, label: getStudentName(s) }));

  const exceptionMemberIds = new Set(
    overrideRows.map(({ f }) => (isGroup ? f.groupId : f.userId)).filter((v): v is string => !!v),
  );

  const audienceMemberIds = assignedToEveryone
    ? allMembers.map((m) => m.id)
    : isGroup
      ? groupRows.map((f) => f.groupId as string)
      : studentRows.map((f) => f.userId as string);

  const selectedAudienceIds = audienceMemberIds.filter((id) => !exceptionMemberIds.has(id));

  const makeAudienceRow = (memberId: string): FormOverride => {
    if (isGroup) {
      const g = groups.find((x) => x.id === memberId);
      return {
        groupId: memberId,
        groupName: g?.name ?? 'Group',
        groupMemberCount: g?.members.length,
        unlockAt: undefined,
        dueDate: undefined,
        allowLateSubmissions: undefined,
        lateCutoff: undefined,
      };
    }
    const s = students.find((x) => x.id === memberId);
    return {
      userId: memberId,
      studentName: s ? getStudentName(s) : 'Student',
      unlockAt: undefined,
      dueDate: undefined,
      allowLateSubmissions: undefined,
      lateCutoff: undefined,
    };
  };

  // Apply a new audience selection, preserving every exception row. When no member is
  // excluded (everyone is covered by the default schedule or an exception) it collapses to
  // the "assigned to everyone" shortcut; otherwise the selected members become explicit rows.
  const setSelectedAudience = (nextIds: string[]) => {
    const exceptionRows = fields.filter((f, i) => isShownOverride(f, overrides[i]));
    const covered = new Set<string>([...nextIds, ...exceptionMemberIds]);
    const everyoneCovered = allMembers.length > 0 && allMembers.every((m) => covered.has(m.id));
    if (everyoneCovered) {
      assignedToEveryoneField.onChange(true);
      replace(exceptionRows);
      return;
    }
    assignedToEveryoneField.onChange(false);
    const audienceOnly = nextIds
      .filter((id) => !exceptionMemberIds.has(id))
      .map((id) => makeAudienceRow(id));
    replace([...exceptionRows, ...audienceOnly]);
  };

  // Candidates for "Add date override": members currently on the default schedule.
  const overrideCandidates: { id: string; label: string }[] = selectedAudienceIds.map(
    (memberId) => {
      if (isGroup) {
        const g = groups.find((x) => x.id === memberId);
        return {
          id: `g:${memberId}`,
          label: `${g?.name ?? 'Group'} (${memberCountLabel(g?.members.length ?? 0)})`,
        };
      }
      const s = students.find((x) => x.id === memberId);
      return { id: `s:${memberId}`, label: s ? getStudentName(s) : 'Student' };
    },
  );

  const addDateOverride = (rawId: string) => {
    const isGroupTarget = rawId.startsWith('g:');
    const id = rawId.slice(2);
    let displayName = 'Student';
    if (isGroupTarget) {
      const idx = fields.findIndex((f) => f.groupId === id);
      const g = groups.find((x) => x.id === id);
      displayName = g?.name ?? 'Group';
      if (idx < 0) {
        append({
          groupId: id,
          groupName: g?.name ?? 'Group',
          groupMemberCount: g?.members.length,
          unlockAt: undefined,
          dueDate: undefined,
          allowLateSubmissions: undefined,
          lateCutoff: undefined,
        });
      }
      markDateOverride(`g:${id}`);
    } else {
      const idx = fields.findIndex((f) => f.userId === id);
      const s = students.find((x) => x.id === id);
      displayName = s ? getStudentName(s) : 'Student';
      if (idx < 0) {
        append({
          userId: id,
          studentName: s ? getStudentName(s) : 'Student',
          unlockAt: undefined,
          dueDate: undefined,
          allowLateSubmissions: undefined,
          lateCutoff: undefined,
        });
      }
      markDateOverride(`s:${id}`);
    }
    const key = `${isGroupTarget ? 'g' : 's'}:${id}`;
    setLiveMessage(`Date override added for ${displayName}.`);
    setFocusTargetId(overrideTriggerId(key));
  };

  const removeDateOverride = (index: number, key: string) => {
    const f = fields[index];
    const displayName = f?.groupId ? (f.groupName ?? 'Group') : (f?.studentName ?? 'Student');
    if (assignedToEveryone) {
      // Purely a date exception on top of "everyone"; drop the row (access stays via everyone).
      remove(index);
    } else {
      // Keep the audience membership: clear the dates but keep the row.
      if (!f) return;
      update(index, {
        userId: f.userId,
        studentName: f.studentName,
        groupId: f.groupId,
        groupName: f.groupName,
        groupMemberCount: f.groupMemberCount,
        unlockAt: undefined,
        dueDate: undefined,
        allowLateSubmissions: undefined,
        lateCutoff: undefined,
      });
    }
    clearSessionKey(key);
    setLiveMessage(`Date override removed for ${displayName}. Assignment access was not changed.`);
    setFocusTargetId(addOverrideId);
  };

  const audienceEmpty = !assignedToEveryone && fields.length === 0;

  return (
    <div className="space-y-5" role="region" aria-labelledby={regionHeadingId}>
      <h3 id={regionHeadingId} className="sr-only">
        Assign to and due dates
      </h3>

      <DueDateSection
        id={audienceHeadingId}
        icon={<Users className="h-4 w-4" />}
        title="Assigned to"
        description={
          isGroup
            ? 'Choose which groups get this assignment. Groups with a date exception are listed below.'
            : 'Choose which students get this assignment. Students with a date exception are listed below.'
        }
        contentClassName="space-y-2"
      >
        <AudienceSelect
          id={`${sectionIdPrefix}-audience-select`}
          label={isGroup ? 'Groups' : 'Students'}
          items={allMembers}
          value={selectedAudienceIds}
          onChange={setSelectedAudience}
          allLabel={isGroup ? 'All groups' : 'All students'}
          addLabel={isGroup ? 'Add group' : 'Add student'}
          searchPlaceholder={isGroup ? 'Search groups…' : 'Search students…'}
          emptyStateText={isGroup ? 'No groups in this set.' : 'No students in this course.'}
          emptySelectionText={isGroup ? 'No groups selected' : 'No students selected'}
          error={
            audienceEmpty
              ? isGroup
                ? 'Select at least one group.'
                : 'Select at least one student.'
              : undefined
          }
        />
      </DueDateSection>

        <DueDateSection
          id={defaultDatesHeadingId}
          icon={<CalendarClock className="h-4 w-4" />}
          title="Default schedule"
          description="These dates apply unless a student or group has an override."
          contentClassName="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <CourseDateTimeField
              control={control}
              name="unlockAt"
              label="Available from (optional)"
              error={errors.unlockAt?.message}
            />
            <CourseDateTimeField
              control={control}
              name="dueDate"
              label="Due"
              error={errors.dueDate?.message}
              requiredMark
            />
          </div>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="allowLateSubmissions"
              render={({ field }) => (
                <SwitchField
                  label="Allow late submissions"
                  name="allowLateSubmissions"
                  checked={!!field.value}
                  onCheckedChange={(checked) => field.onChange(!!checked)}
                  description="Accept work after the due date."
                  descriptionPlacement="inline"
                />
              )}
            />
            {baseAllowLate ? (
              <CourseDateTimeField
                control={control}
                name="lateCutoff"
                label="Accept until (optional)"
                error={errors.lateCutoff?.message}
                min={baseDue || undefined}
              />
            ) : (
              <div className="bg-muted/35 rounded-lg px-3 py-2 text-sm sm:mt-6">
                <span className="font-medium">Closes at the due date</span>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Students cannot submit after it passes.
                </p>
              </div>
            )}
          </div>
          {baseAllowLate ? (
            <p className="text-muted-foreground -mt-2 text-xs">
              Leave “Accept until” blank to allow late work without a cutoff.
            </p>
          ) : null}
        </DueDateSection>

      <DueDateSection
        id={overridesHeadingId}
        icon={<CalendarRange className="h-4 w-4" />}
        title={`Date overrides (${overrideRows.length})`}
        description="Give selected students or groups different dates. Blank fields use the default schedule."
        action={
          <SearchableSelect
            id={addOverrideId}
            label="Add override"
            items={overrideCandidates}
            onSelect={addDateOverride}
            placeholder="Select a student or group"
            searchPlaceholder="Search audience..."
            emptyStateText="Everyone in the audience already has an override."
            restoreFocusAfterSelect={false}
            triggerClassName="bg-card border-black"
          />
        }
        contentClassName="p-0"
      >
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {liveMessage}
        </p>
        {overrideRows.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed px-4 py-6 text-center">
            <p className="text-sm font-medium">No date overrides</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Everyone currently follows the default schedule.
            </p>
          </div>
        ) : (
          <>
            <div
              className="text-muted-foreground hidden grid-cols-[minmax(11rem,1.2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_2.5rem] gap-3 border-b px-4 py-2 text-[11px] font-medium tracking-wide uppercase md:grid"
              aria-hidden="true"
            >
              <span>Student or group</span>
              <span>Available from</span>
              <span>Due</span>
              <span>Late work</span>
              <span />
            </div>
            <ul className="divide-y">
              {overrideRows.map(({ f, index, o }) => {
                const isGroupRow = !!f.groupId;
                const key = overrideKey({ userId: f.userId, groupId: f.groupId }) ?? f.id;
                const displayName = isGroupRow
                  ? (f.groupName ?? 'Group')
                  : (f.studentName ?? 'Student');
                const targetLabel = isGroupRow ? `group ${displayName}` : displayName;
                const isOpen = expandedKeys.has(key);
                const overrideAllowLate = o?.allowLateSubmissions;
                const groupMembers = isGroupRow
                  ? (groups.find((g) => g.id === f.groupId)?.members ?? []).map(
                      (m) => `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email,
                    )
                  : [];

                let lateText: string;
                if (overrideAllowLate === undefined || overrideAllowLate === null) {
                  lateText = baseAllowLate ? 'Default: allowed' : 'Default: closes at due';
                } else if (overrideAllowLate) {
                  lateText = o?.lateCutoff
                    ? `Until ${formatLocal(o.lateCutoff)}`
                    : 'Allowed, no cutoff';
                } else {
                  lateText = 'Closes at due';
                }

                return (
                  <li key={f.id}>
                    <Collapsible open={isOpen} onOpenChange={(open) => toggleExpanded(key, open)}>
                      <div className="hover:bg-muted/20 flex items-stretch gap-1 px-2 sm:px-3">
                        <CollapsibleTrigger
                          id={overrideTriggerId(key)}
                          className="focus-visible:ring-ring grid min-w-0 flex-1 gap-2 rounded-md px-2 py-3 text-left focus-visible:ring-2 focus-visible:outline-none md:grid-cols-[minmax(11rem,1.2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)] md:items-center md:gap-3"
                          aria-label={`Edit date override for ${targetLabel}`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <ChevronDown
                              className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                              aria-hidden="true"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">
                                {displayName}
                              </span>
                              {isGroupRow ? (
                                <span className="text-muted-foreground block text-xs">
                                  {memberCountLabel(f.groupMemberCount)}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <span className="text-muted-foreground pl-6 text-xs md:pl-0">
                            <span className="font-medium md:sr-only">Available: </span>
                            {o?.unlockAt ? (
                              formatLocal(o.unlockAt)
                            ) : (
                              <Badge variant="neutral">Default</Badge>
                            )}
                          </span>
                          <span className="text-muted-foreground pl-6 text-xs md:pl-0">
                            <span className="font-medium md:sr-only">Due: </span>
                            {o?.dueDate ? (
                              formatLocal(o.dueDate)
                            ) : (
                              <Badge variant="neutral">Default</Badge>
                            )}
                          </span>
                          <span className="text-muted-foreground pl-6 text-xs md:pl-0">
                            <span className="font-medium md:sr-only">Late work: </span>
                            {lateText}
                          </span>
                        </CollapsibleTrigger>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="my-2 h-9 w-9 shrink-0"
                          onClick={() => removeDateOverride(index, key)}
                          aria-label={`Remove date override for ${targetLabel}`}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                      <CollapsibleContent className="bg-muted/10 border-t px-4 py-4">
                        {groupMembers.length > 0 ? (
                          <p className="text-muted-foreground mb-3 text-xs">
                            <span className="font-medium">Members:</span> {groupMembers.join(', ')}
                          </p>
                        ) : null}
                        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <CourseDateTimeField
                            control={control}
                            name={`overrides.${index}.unlockAt`}
                            label="Available from"
                          />
                          <CourseDateTimeField
                            control={control}
                            name={`overrides.${index}.dueDate`}
                            label="Due"
                          />
                          <Controller
                            control={control}
                            name={`overrides.${index}.allowLateSubmissions`}
                            render={({ field }) => (
                              <OverrideLatePolicyField
                                id={`${overrideTriggerId(key)}-late-policy`}
                                value={field.value}
                                onChange={field.onChange}
                                defaultAllowsLate={!!baseAllowLate}
                              />
                            )}
                          />
                          {overrideAllowLate ? (
                            <CourseDateTimeField
                              control={control}
                              name={`overrides.${index}.lateCutoff`}
                              label="Accept until (optional)"
                            />
                          ) : (
                            <div className="text-muted-foreground flex min-h-11 items-center text-xs xl:mt-6">
                              {overrideAllowLate === false
                                ? 'This override closes at its due date.'
                                : 'Late-work behavior follows the assignment default.'}
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DueDateSection>
    </div>
  );
}
