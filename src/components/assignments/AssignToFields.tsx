'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Controller,
  useFieldArray,
  useWatch,
  type Control,
  type FieldErrors,
} from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import SwitchField from '@/components/ui/SwitchField';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CourseDateTimeField } from '@/components/dialogs/CourseDateTimeField';
import {
  useRosterStudentOptions,
  getStudentName,
} from '@/components/dialogs/useRosterStudentOptions';
import { ChevronDown, X } from 'lucide-react';
import type { AssignmentWizardFormSchema } from '@/schemas/assignment';

type FormValues = z.input<typeof AssignmentWizardFormSchema>;

/** Render a datetime-local string ("2026-01-10T23:59") as "2026-01-10 23:59". */
function formatLocal(value: string | undefined | null): string {
  return value ? value.replace('T', ' ') : '';
}

/**
 * The "Assign To" section shared by the create wizard and the assignment Settings tab: an
 * "Everyone" base card (availability window, due date, late policy), an "assign to specific
 * students" toggle, and collapsible per-student override cards with a student picker. It
 * operates on the enclosing react-hook-form (fields: assignedToEveryone, unlockAt, dueDate,
 * allowLateSubmissions, lateCutoff, overrides). `active` gates the roster-student fetch.
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
  const { fields, append, remove } = useFieldArray({ control, name: 'overrides' });

  // Override cards collapse to a one-line summary so many due dates stay scannable; the
  // most recently added card auto-expands, the rest keep whatever the user set.
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const prevCount = useRef(0);
  useEffect(() => {
    if (fields.length > prevCount.current && fields.length > 0) {
      const newest = fields[fields.length - 1]?.id;
      if (newest) setOpenCards((prev) => new Set(prev).add(newest));
    }
    prevCount.current = fields.length;
  }, [fields]);
  const setCardOpen = (id: string, open: boolean) =>
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const baseAllowLate = useWatch({ control, name: 'allowLateSubmissions' });
  const baseDue = useWatch({ control, name: 'dueDate' });
  const assignedToEveryone = useWatch({ control, name: 'assignedToEveryone' });
  const overrides = useWatch({ control, name: 'overrides' }) ?? [];

  const students = useRosterStudentOptions(courseId, active);
  // Students already carrying an override are removed from the picker (the server enforces
  // the one-override-per-student rule too).
  const takenIds = new Set(overrides.map((o) => o.userId));
  const pickerItems = students
    .filter((s) => !takenIds.has(s.id))
    .map((s) => ({ id: s.id, label: getStudentName(s) }));

  const everyoneLabel = !assignedToEveryone
    ? 'Default dates'
    : overrides.length > 0
      ? 'Everyone else'
      : 'Everyone';

  const addOverride = (studentId: string) => {
    const student = students.find((s) => s.id === studentId);
    if (!student) return;
    // Start empty so only touched fields materialize; blanks inherit the base dates.
    append({
      userId: student.id,
      studentName: getStudentName(student),
      unlockAt: undefined,
      dueDate: undefined,
      allowLateSubmissions: undefined,
      lateCutoff: undefined,
    });
  };

  return (
    <div className="space-y-4" role="region" aria-labelledby="assign-to-heading">
      <h3 id="assign-to-heading" className="sr-only">
        Assign to and due dates
      </h3>

      <Controller
        control={control}
        name="assignedToEveryone"
        render={({ field }) => (
          <SwitchField
            label="Assign to everyone in the course"
            name="assignedToEveryone"
            checked={field.value !== false}
            onCheckedChange={(checked) => field.onChange(!!checked)}
            description="Turn off to assign only to the students you add below."
            descriptionPlacement="inline"
          />
        )}
      />
      {!assignedToEveryone && (
        <p className="text-muted-foreground text-xs">
          Only the students added below are assigned this work. The dates on the first card are the
          defaults each of them inherits.
        </p>
      )}
      {errors.overrides?.message && (
        <p className="text-xs text-red-600" role="alert">
          {errors.overrides.message}
        </p>
      )}

      {/* Everyone (base) card */}
      <div
        className="space-y-3 rounded-lg border p-4"
        role="group"
        aria-label={`${everyoneLabel} (default dates)`}
      >
        <p className="text-sm font-medium">{everyoneLabel}</p>
        <div className="grid gap-4 md:grid-cols-2">
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
        <Controller
          control={control}
          name="allowLateSubmissions"
          render={({ field }) => (
            <SwitchField
              label="Allow late submissions"
              name="allowLateSubmissions"
              checked={!!field.value}
              onCheckedChange={(checked) => field.onChange(!!checked)}
              description="Accept submissions after the due date until the deadline below."
              descriptionPlacement="inline"
            />
          )}
        />
        {baseAllowLate ? (
          <>
            <CourseDateTimeField
              control={control}
              name="lateCutoff"
              label="Available until (optional)"
              error={errors.lateCutoff?.message}
              min={baseDue || undefined}
            />
            <p className="text-muted-foreground text-xs">
              Leave blank to accept late submissions with no deadline.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">Closes at the due date.</p>
        )}
      </div>

      {/* Per-student override cards, each collapsible to a one-line summary */}
      {fields.map((f, index) => {
        const o = overrides[index];
        const overrideAllowLate = o?.allowLateSubmissions;
        const isOpen = openCards.has(f.id);
        const dueText = o?.dueDate ? formatLocal(o.dueDate) : 'inherits';
        let summary = `Due ${dueText}`;
        if (o?.unlockAt) summary = `From ${formatLocal(o.unlockAt)} · ${summary}`;
        if (o?.allowLateSubmissions && o?.lateCutoff) {
          summary += ` · late until ${formatLocal(o.lateCutoff)}`;
        }
        return (
          <Collapsible
            key={f.id}
            open={isOpen}
            onOpenChange={(open) => setCardOpen(f.id, open)}
            className="rounded-lg border"
            role="group"
            aria-label={`Override for ${f.studentName ?? 'student'}`}
          >
            <div className="flex items-center justify-between gap-2 p-3">
              <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <ChevronDown
                  className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
                <span className="text-sm font-medium">{f.studentName}</span>
                {!isOpen && (
                  <span className="text-muted-foreground truncate text-xs">{summary}</span>
                )}
              </CollapsibleTrigger>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(index)}
                aria-label={`Remove override for ${f.studentName ?? 'student'}`}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <CollapsibleContent className="space-y-3 border-t p-4 pt-3">
              <p className="text-muted-foreground text-xs">
                Leave a field blank to inherit the {everyoneLabel.toLowerCase()} value
                {baseDue ? ` (due ${formatLocal(baseDue)})` : ''}.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
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
              </div>
              <Controller
                control={control}
                name={`overrides.${index}.allowLateSubmissions`}
                render={({ field }) => (
                  <SwitchField
                    label="Allow late submissions"
                    name={`overrides.${index}.allowLateSubmissions`}
                    checked={!!field.value}
                    onCheckedChange={(checked) => field.onChange(!!checked)}
                    descriptionPlacement="inline"
                  />
                )}
              />
              {overrideAllowLate && (
                <CourseDateTimeField
                  control={control}
                  name={`overrides.${index}.lateCutoff`}
                  label="Available until (optional)"
                />
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      {/* Add-student picker: single-select that closes on pick. */}
      <SearchableSelect
        label="Add a student override"
        items={pickerItems}
        onSelect={(studentId) => addOverride(studentId)}
        placeholder="Select a student to give different dates"
        searchPlaceholder="Search students..."
        emptyStateText="No students available."
      />
    </div>
  );
}
