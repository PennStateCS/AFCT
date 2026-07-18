'use client';

import type { Problem } from '@prisma/client';
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
import InputGroup from '@/components/ui/InputGroup';
import { Checkbox } from '@/components/ui/checkbox';
import SwitchField from '@/components/ui/SwitchField';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  CreateProblemSchema,
  ProblemFormSchema,
  type CreateProblemInput,
  type ProblemFormRaw,
} from '@/schemas/problem';
import { showToast } from '@/lib/toast';
import FileUploadInput from '@/components/FileUploadInput';
import { useMaxUploadSize } from '@/hooks/useMaxUploadSize';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { ProblemBasicFields } from '@/components/dialogs/ProblemBasicFields';

// Helper: extract a string message for the file error without using `any`

type CreateProblemDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  // Optional assignment context: when provided, the dialog will automatically
  // add the created problem to the assignment.
  assignmentId?: string;
  onCreated?: (created?: Problem, createdSuccessfully?: boolean) => void;
};

// RHF state BEFORE transforms
type FormValues = ProblemFormRaw;
// Parsed AFTER Zod transforms
type ParsedValues = CreateProblemInput;

// Default to FA + Unlimited, 100 states (disabled when unlimited)
export function CreateProblemDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  assignmentId,
  onCreated,
}: CreateProblemDialogProps) {
  const defaults: FormValues = useMemo(
    () => ({
      title: '',
      description: '',
      type: 'FA',
      isUnlimitedSubmissions: true,
      maxSubmissions: 100,
      maxPoints: 100,
      autograderEnabled: true,
      isUnlimitedStates: true,
      maxStates: 100,
      isDeterministic: false,
      file: undefined,
      courseId: courseId,
    }),
    [courseId],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setError,
    clearErrors,
    formState: { errors, isSubmitting, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(ProblemFormSchema),
    defaultValues: defaults,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const type = watch('type');
  const isUnlimitedStates = watch('isUnlimitedStates');
  const file = watch('file');

  // Internal visibility state, mirrors the parent's `open`.
  const [internalOpen, setInternalOpen] = useState(false);

  const { maxMb, loading: loadingMaxSize } = useMaxUploadSize();

  useEffect(() => {
    reset(defaults, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });
    setInternalOpen(open);
  }, [open, defaults, reset]);

  const resetForm = () => {
    reset(defaults, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });
  };

  const onSubmit = async (raw: FormValues) => {
    try {
      // Form submission

      // Parse with CreateProblemSchema which requires file
      const values: ParsedValues = CreateProblemSchema.parse(raw);

      const formData = new FormData();
      formData.append('title', values.title);
      formData.append('description', values.description ?? '');
      formData.append('type', values.type);
      formData.append(
        'maxSubmissions',
        values.isUnlimitedSubmissions ? '-1' : String(values.maxSubmissions ?? 0),
      );
      formData.append('maxPoints', String(values.maxPoints));
      formData.append('autograderEnabled', String(!!values.autograderEnabled));
      formData.append('courseId', values.courseId);

      if (values.type === 'FA' || values.type === 'PDA') {
        formData.append(
          'maxStates',
          values.isUnlimitedStates ? '-1' : String(values.maxStates ?? 0),
        );
      }
      if (values.type === 'FA') {
        formData.append('isDeterministic', String(!!values.isDeterministic));
      }

      formData.append('file', values.file);

      let created: Problem | null = null;
      try {
        created = await apiClient.postForm<Problem>(
          apiPaths.courseProblems(values.courseId),
          formData,
        );
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('Failed to create problem:', err.message);
          // 4xx = validation/user error → show inline on the file field; 5xx → toast.
          if (err.status >= 400 && err.status < 500) {
            setError('file', { type: 'manual', message: err.message });
          } else {
            showToast.error(err.message);
          }
          return;
        }
        throw err;
      }

      // If we were opened in the context of an assignment, automatically add the
      // created problem to it (best-effort).
      if (created?.id && assignmentId) {
        try {
          await apiClient.post(apiPaths.assignmentProblems(courseId, assignmentId), {
            problemIds: [created.id],
          });
        } catch (err) {
          console.error('Failed to add created problem to assignment:', err);
        }
      }

      onCreated?.(created ?? undefined, true);
      resetForm();
      setOpen(false);
    } catch (error) {
      console.error('Form submission error:', error);
      if (typeof error === 'string') {
        setError('file', { type: 'manual', message: error });
        return;
      }
      if (error instanceof z.ZodError) {
        // Handle Zod validation errors (Zod 4 renamed `.errors` to `.issues`).
        const message = error.issues?.map((e) => e.message).join();
        showToast.error(`Error: ${message}`);
      }
    }
  };

  return (
    <Dialog
      open={internalOpen}
      onOpenChange={(val) => {
        // only propagate close events back to parent
        if (!val) {
          setOpen(false);
          resetForm();
          setInternalOpen(false);
        }
      }}
    >
      <DialogContent
        className="bg-card max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create Problem</DialogTitle>
          <DialogDescription>
            Fill in the problem details and upload the solution file.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ProblemBasicFields control={control} errors={errors} />

          {/* Max States (FA/PDA only) */}
          {(type === 'FA' || type === 'PDA') && (
            <Controller
              control={control}
              name="maxStates"
              render={({ field }) => (
                <div>
                  <InputGroup
                    label="Max States"
                    name="maxStates"
                    type="number"
                    fieldProps={{
                      ...field,
                      value: isUnlimitedStates ? '' : String(field.value || ''),
                    }}
                    min={1}
                    max={1_000}
                    disabled={isUnlimitedStates}
                    error={errors.maxStates?.message}
                  />
                  <div className="mt-1 flex items-center gap-2">
                    <Controller
                      control={control}
                      name="isUnlimitedStates"
                      render={({ field: uf }) => (
                        <>
                          <Checkbox
                            checked={!!uf.value}
                            onCheckedChange={(val) => uf.onChange(!!val)}
                          />
                          <span className="text-muted-foreground text-sm">Unlimited</span>
                        </>
                      )}
                    />
                  </div>
                </div>
              )}
            />
          )}

          {/* Deterministic (FA only) */}
          {type === 'FA' && (
            <Controller
              control={control}
              name="isDeterministic"
              render={({ field }) => (
                <SwitchField
                  label="Deterministic"
                  name="isDeterministic"
                  id="isDeterministic"
                  checked={!!field.value}
                  onCheckedChange={(checked) => field.onChange(!!checked)}
                />
              )}
            />
          )}

          <Controller
            control={control}
            name="autograderEnabled"
            render={({ field }) => (
              <SwitchField
                label="Automatically Graded"
                name="autograderEnabled"
                id="autograderEnabled"
                checked={!!field.value}
                onCheckedChange={(checked) => field.onChange(!!checked)}
              />
            )}
          />

          {/* File upload with drag-and-drop and size validation */}
          <Controller
            control={control}
            name="file"
            render={({ field: { onChange, value } }) => (
              <FileUploadInput
                id="answer-file"
                name="file"
                label="Answer File"
                accept=".txt,.fa,.pda,.cfg,.re,.jff"
                maxSizeMb={maxMb}
                value={value}
                onChange={async (file) => {
                  if (file) {
                    const text = await file.text();
                    if (!text.trimStart().startsWith('<')) {
                      setError('file', {
                        type: 'manual',
                        message: 'File must be a valid XML file (.jff, .fa, .pda, etc.)',
                      });
                      onChange(undefined);
                      return;
                    }
                    // Check JFLAP structure type matches the selected problem type
                    const expectedType =
                      type === 'CFG' ? 'GRAMMAR' : type === 'TM' ? 'TURING' : type;
                    const typeMatch = text.match(/<type[^>]*>([\s\S]*?)<\/type>/i);
                    const fileType = typeMatch?.[1]?.trim().toUpperCase();
                    if (fileType && fileType !== expectedType) {
                      setError('file', {
                        type: 'manual',
                        message: `File is type ${fileType} but problem type is ${type} — please upload the correct file.`,
                      });
                      onChange(undefined);
                      return;
                    }
                    clearErrors('file');
                  }
                  onChange(file);
                }}
                error={typeof errors.file?.message === 'string' ? errors.file.message : undefined}
                disabled={loadingMaxSize || courseIsArchived}
                hint="Supported formats: .txt, .fa, .pda, .cfg, .re, .jff"
              />
            )}
          />

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={isSubmitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!isValid || isSubmitting || !file || courseIsArchived}>
              {isSubmitting ? 'Creating…' : 'Create Problem'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
