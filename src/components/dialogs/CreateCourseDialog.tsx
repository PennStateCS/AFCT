'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import SwitchField from '@/components/ui/SwitchField';
import { Button } from '@/components/ui/button';
import { User } from '@prisma/client';
import { toast } from 'sonner';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import { EMPTY_STRING_NOTATION_OPTIONS } from '@/lib/empty-string-notation';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateCourseFormSchema, // Form schema (no transformations)
} from '@/schemas/course';
import { z } from 'zod';

// RHF form state = Zod INPUT (strings for datetime-local)
type FormValues = z.infer<typeof CreateCourseFormSchema>;

interface CreateCourseDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateCourseDialog({ open, setOpen, onSuccess }: CreateCourseDialogProps) {
  // Default form values (strings for datetime-local)
  const defaults: FormValues = useMemo(
    () => ({
      name: '',
      code: '',
      semester: '',
      credits: '3',
      startDate: '', // <- strings for input type="datetime-local"
      endDate: '',
      registrationOpenAt: '',
      registrationCloseAt: '',
      isPublished: false,
      instructorIds: [],
      emptyStringNotation: 'EPSILON',
    }),
    [],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(CreateCourseFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  const isPublished = watch('isPublished');
  const startDateStr = watch('startDate'); // string (YYYY-MM-DDTHH:MM)

  // Fetch faculty list when dialog opens
  const [facultyList, setFacultyList] = useState<User[]>([]);
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch('/api/users?role=FACULTY');
        if (!res.ok) throw new Error('Failed to load faculty');
        const data = await res.json();
        setFacultyList((Array.isArray(data) ? data : []).filter((user) => user.role === 'FACULTY'));
      } catch {
        toast.error('Failed to load faculty list.');
      }
    })();
  }, [open]);

  const resetForm = () =>
    reset(defaults, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });

  const onSubmit = async (raw: FormValues) => {
    const payload: Record<string, unknown> = {
      ...raw,
      code: raw.code.trim().replace(/\s+/g, ' ').toUpperCase(),
      credits: Number(raw.credits),
    };

    const res = await fetch('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      toast.success('Course created successfully');
      resetForm();
      setOpen(false);
      onSuccess?.();
    } else {
      const msg = await safeMessage(res);
      toast.error(msg ?? 'Failed to create course');
    }
  };

  const onSubmitWrapper = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSubmit((data) => onSubmit(data as unknown as FormValues))(e);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm(); // also reset when closed from outside
      }}
    >
      <DialogContent
        className="bg-card max-w-2xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create Course</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* NAME */}
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <InputGroup
                label="Course Name"
                name="name"
                fieldProps={field}
                error={errors.name?.message}
              />
            )}
          />

          {/* CODE */}
          <Controller
            control={control}
            name="code"
            render={({ field }) => (
              <InputGroup
                label="Course Code"
                name="code"
                fieldProps={field}
                placeholder="CMPSC 131"
                error={errors.code?.message}
                showStatus
              />
            )}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <Controller
              control={control}
              name="semester"
              render={({ field }) => (
                <InputGroup
                  label="Semester"
                  name="semester"
                  fieldProps={field}
                  placeholder="Fall 2025"
                  error={errors.semester?.message}
                />
              )}
            />

            <Controller
              control={control}
              name="credits"
              render={({ field }) => (
                <InputGroup
                  label="Credits"
                  name="credits"
                  type="number"
                  fieldProps={field}
                  min={1}
                  max={6}
                  step={1}
                  error={errors.credits?.message}
                />
              )}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* START datetime-local (string) */}
            <Controller
              control={control}
              name="startDate"
              render={({ field }) => (
                <InputGroup
                  label="Start Date & Time"
                  name="startDate"
                  type="datetime-local"
                  fieldProps={{
                    ...field,
                    value: field.value ?? '', // expect a string for datetime-local
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                      field.onChange(e.target.value),
                  }}
                  error={errors.startDate?.message}
                  requiredMark
                />
              )}
            />

            {/* END datetime-local (string) */}
            <Controller
              control={control}
              name="endDate"
              render={({ field }) => (
                <InputGroup
                  label="End Date & Time"
                  name="endDate"
                  type="datetime-local"
                  fieldProps={{
                    ...field,
                    value: field.value ?? '',
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                      field.onChange(e.target.value),
                  }}
                  error={errors.endDate?.message}
                  min={startDateStr || undefined} // prevent picking an end earlier than start
                  requiredMark
                />
              )}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Controller
              control={control}
              name="registrationOpenAt"
              render={({ field }) => (
                <InputGroup
                  label="Self Registration Opens"
                  name="registrationOpenAt"
                  type="datetime-local"
                  fieldProps={{
                    ...field,
                    value: field.value ?? '',
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                      field.onChange(e.target.value),
                  }}
                  error={errors.registrationOpenAt?.message}
                  requiredMark
                />
              )}
            />

            <Controller
              control={control}
              name="registrationCloseAt"
              render={({ field }) => (
                <InputGroup
                  label="Self Registration Closes"
                  name="registrationCloseAt"
                  type="datetime-local"
                  fieldProps={{
                    ...field,
                    value: field.value ?? '',
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                      field.onChange(e.target.value),
                  }}
                  error={errors.registrationCloseAt?.message}
                  requiredMark
                />
              )}
            />
          </div>

          <Controller
            control={control}
            name="instructorIds"
            render={({ field }) => (
              <SearchableMultiSelect
                label="Assign Faculty"
                items={facultyList.map((faculty) => ({
                  id: faculty.id,
                  label:
                    `${faculty.firstName ?? ''} ${faculty.lastName ?? ''}`.trim() ||
                    faculty.email ||
                    'Unknown user',
                }))}
                value={field.value ?? []}
                onChange={(value) => field.onChange(value)}
                placeholder="Select faculty"
                searchPlaceholder="Search faculty..."
                emptyStateText="No faculty found."
                error={errors.instructorIds?.message}
              />
            )}
          />

          {/* EMPTY STRING NOTATION */}
          <Controller
            control={control}
            name="emptyStringNotation"
            render={({ field }) => (
              <SelectField
                label="Empty string notation"
                name="emptyStringNotation"
                id="emptyStringNotation"
                value={field.value}
                onValueChange={field.onChange}
                options={EMPTY_STRING_NOTATION_OPTIONS}
                description="Choose how the empty string should appear in automata and languages."
                error={errors.emptyStringNotation?.message}
              />
            )}
          />

          {/* PUBLISH SWITCH */}
          <Controller
            control={control}
            name="isPublished"
            render={({ field }) => (
              <SwitchField
                label="Publish Now"
                name="isPublished"
                checked={!!field.value}
                onCheckedChange={(checked) => field.onChange(!!checked)}
                description="Makes the course visible to enrolled students."
                descriptionPlacement="inline"
              />
            )}
          />

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  // Clear touched/dirty/errors to avoid red flash on close
                  resetForm();
                }}
              >
                Cancel
              </Button>
            </DialogClose>

            <Button type="submit" disabled={isSubmitting || !isValid}>
              {isSubmitting ? 'Creating…' : 'Create Course'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

async function safeMessage(res: Response) {
  try {
    const data = await res.json();
    return data?.message ?? null;
  } catch {
    return null;
  }
}
