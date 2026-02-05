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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { User } from '@prisma/client';
import { toast } from 'sonner';
import InputGroup from '@/components/ui/InputGroup';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      isPublished: false,
      facultyIds: [],
      instructorIds: [],
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
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const isPublished = watch('isPublished');
  const startDateStr = watch('startDate'); // string (YYYY-MM-DDTHH:MM)

  const [instructorSearch, setInstructorSearch] = useState('');
  const [instructorMenuOpen, setInstructorMenuOpen] = useState(false);

  // Fetch faculty list when dialog opens
  const [facultyList, setFacultyList] = useState<User[]>([]);
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch('/api/users?role=FACULTY');
        if (!res.ok) throw new Error('Failed to load faculty');
        const data = await res.json();
        setFacultyList(data);
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
    // Convert form values to the format expected by the API schema
    const formData = {
      ...raw,
      credits: Number(raw.credits), // Convert string to number for API schema
      // Date strings remain as-is for API schema to transform
    };

    const payload = {
      ...formData,
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
                placeholder="e.g., CMPSC 221"
                error={errors.code?.message}
                showStatus
              />
            )}
          />

          {/* SEMESTER */}
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

          {/* CREDITS */}
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
              />
            )}
          />

          <div>
            <Label className="pb-2">Assign Faculty</Label>
            <Controller
              control={control}
              name="instructorIds"
              render={({ field }) => {
                const selectedIds = field.value ?? [];
                const selectedNames = facultyList
                  .filter((f) => selectedIds.includes(f.id))
                  .map((f) => `${f.firstName} ${f.lastName}`.trim())
                  .filter(Boolean)
                  .join(', ');
                const hasSelection = selectedNames.length > 0;

                const filteredFaculty = facultyList.filter((faculty) => {
                  const q = instructorSearch.toLowerCase();
                  if (!q) return true;
                  return (
                    (faculty.firstName ?? '').toLowerCase().includes(q) ||
                    (faculty.lastName ?? '').toLowerCase().includes(q)
                  );
                });

                return (
                  <div>
                    <DropdownMenu open={instructorMenuOpen} onOpenChange={setInstructorMenuOpen}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="border-input h-9 w-full justify-between bg-transparent px-3 py-1 text-sm shadow-xs"
                        >
                          <span
                            className={cn('truncate', !hasSelection && 'text-muted-foreground')}
                          >
                            {selectedNames || 'Select faculty'}
                          </span>
                          <ChevronDown className="text-muted-foreground h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] p-2">
                        <Input
                          placeholder="Search faculty..."
                          value={instructorSearch}
                          onChange={(e) => setInstructorSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="mb-2"
                        />
                        <div className="max-h-64 overflow-auto rounded border">
                          {filteredFaculty.length === 0 ? (
                            <div className="text-muted-foreground p-3 text-center text-sm">
                              No faculty found.
                            </div>
                          ) : (
                            filteredFaculty.map((faculty) => {
                              const checked = selectedIds.includes(faculty.id);
                              return (
                                <label
                                  key={faculty.id}
                                  className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const set = new Set(selectedIds);
                                      if (set.has(faculty.id)) set.delete(faculty.id);
                                      else set.add(faculty.id);
                                      field.onChange(Array.from(set));
                                    }}
                                  />
                                  <span>
                                    {faculty.firstName} {faculty.lastName}
                                  </span>
                                </label>
                              );
                            })
                          )}
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {errors.instructorIds ? (
                      <p className="mt-1 text-xs text-red-600">{errors.instructorIds.message}</p>
                    ) : null}
                  </div>
                );
              }}
            />
          </div>

          {/* PUBLISH SWITCH */}
          <div className="flex items-center justify-between">
            <Label htmlFor="isPublished">Publish Now</Label>
            <Controller
              control={control}
              name="isPublished"
              render={({ field }) => (
                <Switch
                  id="isPublished"
                  checked={!!field.value}
                  onCheckedChange={(checked) => field.onChange(!!checked)}
                />
              )}
            />
          </div>

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
