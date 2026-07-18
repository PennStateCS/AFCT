'use client';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { Assignment } from '@prisma/client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Settings } from 'lucide-react';
import SwitchField from '@/components/ui/SwitchField';
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { AssignmentFormSchema, UpdateAssignmentSchema } from '@/schemas/assignment';

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

function nowLocalString(timeZone: string): string {
  return toDateTimeLocalInTimeZone(new Date(), timeZone);
}

type AssignmentWithUnlock = Assignment & { unlockAt?: Date | string | null };

type Props = {
  courseId: string;
  assignment: AssignmentWithUnlock;
  timeZone: string;
  courseIsArchived: boolean;
  onSaved?: (updated: Assignment) => void;
};

// RHF state before Zod transforms (strings for datetime-local).
type FormValues = z.input<typeof AssignmentFormSchema>;

/**
 * The assignment's settings, edited in place on the assignment page's Settings tab. Holds
 * the fields that used to live in the Edit Assignment dialog (title, description, the
 * availability window and due date, late policy, publication, group mode) and saves them
 * with one PUT. Per-student due-date overrides are managed from the create wizard.
 */
export function AssignmentSettingsCard({
  courseId,
  assignment,
  timeZone,
  courseIsArchived,
  onSaved,
}: Props) {
  const dueString = useMemo(
    () => toDateTimeLocalInTimeZone(assignment.dueDate, timeZone),
    [assignment.dueDate, timeZone],
  );
  const unlockString = useMemo(
    () => (assignment.unlockAt ? toDateTimeLocalInTimeZone(assignment.unlockAt, timeZone) : undefined),
    [assignment.unlockAt, timeZone],
  );
  const cutoffString = useMemo(
    () => (assignment.lateCutoff ? toDateTimeLocalInTimeZone(assignment.lateCutoff, timeZone) : undefined),
    [assignment.lateCutoff, timeZone],
  );

  const defaultValues: FormValues = useMemo(
    () => ({
      title: assignment.title ?? '',
      description: assignment.description ?? '',
      unlockAt: unlockString,
      dueDate: dueString,
      allowLateSubmissions: assignment.allowLateSubmissions ?? false,
      lateCutoff: cutoffString,
      isPublished: assignment.isPublished ?? false,
      isGroup: assignment.isGroup ?? false,
      courseId,
    }),
    [
      assignment.allowLateSubmissions,
      assignment.description,
      assignment.isGroup,
      assignment.isPublished,
      assignment.title,
      courseId,
      cutoffString,
      dueString,
      unlockString,
    ],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isValid, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(AssignmentFormSchema),
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const allowLateSubmissions = watch('allowLateSubmissions');
  const dueDateValue = watch('dueDate');

  // Re-seed the form whenever the saved assignment changes (e.g. after a save refetch).
  useEffect(() => {
    reset(defaultValues, { keepDirty: false, keepTouched: false, keepErrors: false });
  }, [defaultValues, reset]);

  // Clear the cutoff when late is turned off. It stays optional when on (blank = no deadline).
  useEffect(() => {
    if (!allowLateSubmissions) {
      setValue('lateCutoff', undefined, { shouldValidate: true, shouldDirty: false });
    }
  }, [allowLateSubmissions, setValue]);

  const onSubmit = async (raw: FormValues) => {
    const payload = UpdateAssignmentSchema.parse({ id: assignment.id, ...raw });
    const body = {
      ...payload,
      unlockAt: payload.unlockAt ?? null,
      lateCutoff: payload.allowLateSubmissions ? (payload.lateCutoff ?? null) : null,
      isGroup: payload.isGroup ?? false,
    };

    try {
      const res = await fetch(apiPaths.assignment(courseId, assignment.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast.error(data?.error || data?.message || `Server returned ${res.status}`);
        return;
      }
      const updated = (await res.json()) as Assignment;
      showToast.success('Assignment settings saved');
      onSaved?.(updated);
    } catch (err) {
      showToast.error(`Network error saving settings: ${(err as Error).message || err}`);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-2xl">
          <Settings className="h-6 w-6" />
          Settings
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="max-w-2xl space-y-4"
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

          <div className="grid gap-4 md:grid-cols-2">
            <Controller
              name="unlockAt"
              control={control}
              render={({ field }) => (
                <InputGroup
                  label="Available from (optional)"
                  name="unlockAt"
                  type="datetime-local"
                  fieldProps={{
                    ...field,
                    value: field.value ?? '',
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => field.onChange(e.target.value),
                  }}
                  error={errors.unlockAt?.message}
                />
              )}
            />
            <Controller
              name="dueDate"
              control={control}
              render={({ field }) => (
                <InputGroup
                  label="Due Date & Time"
                  name="dueDate"
                  type="datetime-local"
                  fieldProps={{
                    ...field,
                    value: field.value ?? '',
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => field.onChange(e.target.value),
                  }}
                  error={errors.dueDate?.message}
                />
              )}
            />
          </div>

          <Controller
            name="allowLateSubmissions"
            control={control}
            render={({ field }) => (
              <SwitchField
                label="Allow Late Submissions"
                name="allowLateSubmissions"
                checked={!!field.value}
                onCheckedChange={(checked) => field.onChange(!!checked)}
                description="Students can submit after the deadline, until the cutoff below."
                descriptionPlacement="inline"
              />
            )}
          />

          {allowLateSubmissions && (
            <>
              <Controller
                name="lateCutoff"
                control={control}
                render={({ field }) => (
                  <InputGroup
                    label="Late Submission Cutoff (optional)"
                    name="lateCutoff"
                    type="datetime-local"
                    fieldProps={{
                      ...field,
                      value: field.value ?? '',
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) => field.onChange(e.target.value),
                    }}
                    min={dueDateValue ?? nowLocalString(timeZone)}
                    error={errors.lateCutoff?.message}
                  />
                )}
              />
              <p className="text-muted-foreground text-xs">
                Leave blank to accept late submissions with no deadline.
              </p>
            </>
          )}

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
      </CardContent>
    </Card>
  );
}
