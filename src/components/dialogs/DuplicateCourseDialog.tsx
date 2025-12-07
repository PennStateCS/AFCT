"use client";

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CourseFormSchema } from '@/schemas/course';
import { FullCourse } from '@/types/course';

// Build a form schema: base fields + copy mode
const DuplicateFormSchema = CourseFormSchema.extend({
  copyMode: z.enum([
    'assignments',
    'assignments_with_problems',
    'problems',
  ]).optional(),
  copyFaculty: z.boolean().optional(),
  copyTAs: z.boolean().optional(),
});

type FormValues = z.infer<typeof DuplicateFormSchema>;

interface Props {
  open: boolean;
  setOpen: (v: boolean) => void;
  course: FullCourse | null;
  onSuccess?: (newId: string) => void;
}

export default function DuplicateCourseDialog({ open, setOpen, course, onSuccess }: Props) {
  const defaults: FormValues = {
    name: course?.name ?? '',
    code: course?.code ?? '',
    semester: course?.semester ?? '',
    credits: String(course?.credits ?? 3),
    startDate: course ? new Date(course.startDate).toISOString().slice(0,16) : '',
    endDate: course ? new Date(course.endDate).toISOString().slice(0,16) : '',
  copyMode: 'assignments_with_problems',
  copyFaculty: false,
  copyTAs: false,
  };

  const { control, handleSubmit, reset, trigger, getValues, formState: { errors, isSubmitting, isValid } } = useForm<FormValues>({
    resolver: zodResolver(DuplicateFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
  });

  const [step, setStep] = useState<number>(1);

  const [confirmChecked, setConfirmChecked] = useState(false);

  useEffect(() => {
    if (!open) return;
    // reset with current course values when opening (use live course to avoid stale defaults)
    const vals: FormValues = {
      name: course?.name ?? '',
      code: course?.code ?? '',
      semester: course?.semester ?? '',
      credits: String(course?.credits ?? 3),
      startDate: course ? new Date(course.startDate).toISOString().slice(0,16) : '',
      endDate: course ? new Date(course.endDate).toISOString().slice(0,16) : '',
      copyMode: 'assignments_with_problems',
      copyFaculty: false,
      copyTAs: false,
    };
    reset(vals);
  setConfirmChecked(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, course]);

  const onSubmit = async (raw: FormValues) => {
    // Build payload
    const mode = raw.copyMode ?? 'assignments_with_problems';
    const payload = {
      title: raw.name,
      code: raw.code,
      semester: raw.semester,
      startDate: new Date(raw.startDate).toISOString(),
      endDate: new Date(raw.endDate).toISOString(),
      credits: Number(raw.credits),
      copyAssignments: mode === 'assignments' || mode === 'assignments_with_problems',
      copyProblems: mode === 'problems' || mode === 'assignments_with_problems',
      copyFaculty: !!raw.copyFaculty,
      copyTAs: !!raw.copyTAs,
    };

    try {
      const res = await fetch(`/api/courses/${course?.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || res.statusText || 'Failed to duplicate');
      }
      const data = await res.json();
      setOpen(false);
      onSuccess?.(data.id);
      // navigate to new course page
      window.location.href = `/dashboard/courses/${data.id}`;
    } catch (e) {
      // show inline error (could be improved)
      const errMsg = (e as Error)?.message ?? String(e);
      alert(errMsg || 'Failed to duplicate course');
    }
  };

  type FieldName = 'name'|'code'|'semester'|'credits'|'startDate'|'endDate'|'copyMode'|'copyFaculty'|'copyTAs';
  const fieldsForStep = (s: number): FieldName[] => {
    if (s === 1) return ['name', 'code', 'semester', 'credits', 'startDate', 'endDate'];
    if (s === 2) return ['copyMode', 'copyFaculty', 'copyTAs'];
    return [];
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { reset(defaults); setStep(1); } }}>
      <DialogContent className="bg-card max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Copy className="size-4 text-muted-foreground" />
            <DialogTitle>Duplicate Course</DialogTitle>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Step {step} of 3 — {step === 1 ? 'Course details' : step === 2 ? 'What to copy' : 'Roster copy options'}</p>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {step === 1 && (
            <>
              <Controller control={control} name="name" render={({ field }) => (
                <InputGroup label="Course Name" name="name" isValid={!!field.value} fieldProps={field} error={errors.name?.message as string | undefined} />
              )} />

              <Controller control={control} name="code" render={({ field }) => (
                <InputGroup label="Course Code" name="code" isValid={!!field.value} fieldProps={field} error={errors.code?.message as string | undefined} />
              )} />

              <Controller control={control} name="semester" render={({ field }) => (
                <InputGroup label="Semester" name="semester" isValid={!!field.value} fieldProps={field} error={errors.semester?.message as string | undefined} />
              )} />

              <Controller control={control} name="credits" render={({ field }) => (
                <InputGroup label="Credits" name="credits" type="number" isValid={!!field.value} fieldProps={field} min={1} max={6} />
              )} />

              <Controller control={control} name="startDate" render={({ field }) => (
                <InputGroup label="Start Date & Time" name="startDate" type="datetime-local" isValid={!!field.value} fieldProps={{ ...field, value: field.value ?? '' }} />
              )} />

              <Controller control={control} name="endDate" render={({ field }) => (
                <InputGroup label="End Date & Time" name="endDate" type="datetime-local" isValid={!!field.value} fieldProps={{ ...field, value: field.value ?? '' }} />
              )} />

            </>
          )}

          {step === 2 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">What would you like to copy?</div>
              <Controller control={control} name="copyMode" render={({ field }) => (
                <div className="space-y-1">
                  <label className="flex items-start gap-2">
                    <input type="radio" name="copyMode" value="assignments" checked={field.value === 'assignments'} onChange={() => field.onChange('assignments')} />
                    <div>
                      <div className="font-medium">Assignments only</div>
                      <div className="text-sm text-muted-foreground">Copy assignments only; assignments will not reference problems.</div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2">
                    <input type="radio" name="copyMode" value="assignments_with_problems" checked={field.value === 'assignments_with_problems'} onChange={() => field.onChange('assignments_with_problems')} />
                    <div>
                      <div className="font-medium">Assignments and their problems</div>
                      <div className="text-sm text-muted-foreground">Copy assignments and duplicate the problems attached to each assignment; new assignments will reference copied problems only.</div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2">
                    <input type="radio" name="copyMode" value="problems" checked={field.value === 'problems'} onChange={() => field.onChange('problems')} />
                    <div>
                      <div className="font-medium">Problems only</div>
                      <div className="text-sm text-muted-foreground">Copy problems only; no assignments will be created.</div>
                    </div>
                  </label>
                </div>
              )} />

              <div className="space-y-3">
                <div className="text-sm">Choose roster copy options</div>
                <div className="flex items-center gap-4">
                  <Controller control={control} name="copyFaculty" render={({ field }) => (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />
                      <span className="text-sm">Copy faculty roster</span>
                    </label>
                  )} />

                  <Controller control={control} name="copyTAs" render={({ field }) => (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />
                      <span className="text-sm">Copy TA roster</span>
                    </label>
                  )} />
                </div>
                <div className="text-xs text-muted-foreground">The current user will always be added as faculty to the duplicated course.</div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Summary</div>
              <div className="grid grid-cols-1 gap-2 text-sm">
                {(() => {
                  const v = getValues();
                  const modeLabel = v.copyMode === 'assignments' ? 'Assignments only' : v.copyMode === 'problems' ? 'Problems only' : 'Assignments and their problems';
                  return (
                    <>
                      <div><strong>Name:</strong> {v.name}</div>
                      <div><strong>Code:</strong> {v.code}</div>
                      <div><strong>Semester:</strong> {v.semester}</div>
                      <div><strong>Dates:</strong> {v.startDate || '—'} to {v.endDate || '—'}</div>
                      <div><strong>Credits:</strong> {v.credits}</div>
                      <div><strong>Copy mode:</strong> {modeLabel}</div>
                      <div><strong>Copy faculty roster:</strong> {v.copyFaculty ? 'Yes' : 'No'}</div>
                      <div><strong>Copy TA roster:</strong> {v.copyTAs ? 'Yes' : 'No'}</div>
                    </>
                  );
                })()}
              </div>

              <div className="pt-2 text-xs text-muted-foreground">The duplicated course will be created as unpublished and the current user will be added as faculty. Submissions will not be copied.</div>

              <label className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={confirmChecked} disabled={isSubmitting} onChange={(e) => setConfirmChecked(e.target.checked)} />
                <span className="text-sm">I confirm I want to duplicate this course with the options above</span>
              </label>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={isSubmitting} onClick={() => { setStep(1); reset(defaults); }}>Cancel</Button>
            </DialogClose>

            {step > 1 && (
              <Button type="button" variant="default" disabled={isSubmitting} onClick={() => setStep((s) => Math.max(1, s - 1))}>Back</Button>
            )}

            {step < 3 ? (
              <Button type="button" disabled={!isValid} onClick={async () => {setStep((s) => Math.min(3, s + 1));}}>
                Next
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting || !confirmChecked}>{isSubmitting ? 'Copying…' : 'Duplicate Course'}</Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
