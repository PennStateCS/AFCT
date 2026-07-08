'use client';

import { Problem } from '@prisma/client';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import InputGroup from '@/components/ui/InputGroup';
import { Checkbox } from '@/components/ui/checkbox';
import SwitchField from '@/components/ui/SwitchField';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { Check, ChevronDown, Search as SearchIcon } from 'lucide-react';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  CreateProblemSchema,
  ProblemFormSchema,
  ProblemTypeEnum,
  type CreateProblemInput,
  type ProblemFormRaw,
} from '@/schemas/problem';
import { showToast } from '@/lib/toast';
import FileUploadInput from '@/components/FileUploadInput';
import { useMaxUploadSize } from '@/hooks/useMaxUploadSize';
import { apiPaths } from '@/lib/api-paths';

// Helper: extract a string message for the file error without using `any`

type CreateProblemDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  // Optional assignment context: when provided, the dialog will automatically
  // add the created problem to the assignment and optionally assign it to a group.
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

  // Group assignment support (only relevant when opened in assignment context)
  const [assignmentIsGroup, setAssignmentIsGroup] = useState(false);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<'ALL' | string>('ALL');
  const [groupFilter, setGroupFilter] = useState('');
  const filteredGroups = useMemo(() => {
    const q = groupFilter.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, groupFilter]);

  // Internal visibility state: only show dialog after groups are loaded (if needed)
  const [internalOpen, setInternalOpen] = useState(false);
  const [, setInitializing] = useState(false);

  const { maxMb, loading: loadingMaxSize } = useMaxUploadSize();

  useEffect(() => {
    let aborted = false;
    const ac = new AbortController();

    async function init() {
      setInitializing(true);
      setInternalOpen(false);
      setSelectedGroupId('ALL');
      setAssignmentIsGroup(false);
      setGroups([]);
      setGroupsLoading(false);

      try {
        if (assignmentId) {
          const res = await fetch(apiPaths.assignment(courseId, assignmentId), {
            signal: ac.signal,
          });
          if (!res.ok) {
            // treat as non-group assignment on failure
            setAssignmentIsGroup(false);
          } else {
            const data = await res.json();
            setAssignmentIsGroup(!!data?.isGroup);
            if (data?.isGroup) {
              setGroupsLoading(true);
              try {
                const gr = await fetch(apiPaths.courseGroups(courseId));
                if (gr.ok) {
                  const gdata = await gr.json();
                  setGroups(Array.isArray(gdata) ? gdata : []);
                } else {
                  setGroups([]);
                }
              } catch (err) {
                if ((err as { name?: string } | null)?.name === 'AbortError') return;
                console.error('Failed to load groups:', err);
                setGroups([]);
              } finally {
                setGroupsLoading(false);
              }
            } else {
              setGroups([]);
            }
          }
        } else {
          setAssignmentIsGroup(false);
          setGroups([]);
        }
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
        console.error('Failed to load assignment info:', err);
        setAssignmentIsGroup(false);
        setGroups([]);
        setGroupsLoading(false);
      } finally {
        if (!aborted) {
          // Ready to open the dialog: reset form and show
          reset(defaults, {
            keepDirty: false,
            keepTouched: false,
            keepErrors: false,
            keepValues: false,
          });
          setInternalOpen(true);
          setInitializing(false);
        }
      }
    }

    if (open) {
      init();
    } else {
      // parent closed while we were possibly initializing
      setInternalOpen(false);
      setInitializing(false);
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
      setSelectedGroupId('ALL');
      setAssignmentIsGroup(false);
      setGroups([]);
      setGroupsLoading(false);
    }

    return () => {
      aborted = true;
      ac.abort();
    };
  }, [open, defaults, reset, assignmentId, courseId]);

  const resetForm = () => {
    reset(defaults, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });
    setSelectedGroupId('ALL');
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
      const res = await fetch(apiPaths.problems(), { method: 'POST', body: formData });

      if (res.ok) {
        const created = await res.json().catch(() => null);

        // If we were opened in the context of an assignment, automatically add
        // the created problem to that assignment (group assignment support is based on assignment.groupId)
        if (created?.id && assignmentId) {
          try {
            const payload: { problemIds: string[]; groupId?: string } = {
              problemIds: [created.id],
            };
            // If the assignment supports group assignments and a specific group
            // was chosen (not 'ALL'), include the groupId. If 'ALL' is chosen,
            // omit groupId to assign to all students.
            if (assignmentIsGroup && selectedGroupId && selectedGroupId !== 'ALL') {
              payload.groupId = selectedGroupId;
            }

            const ar = await fetch(apiPaths.assignmentProblems(courseId, assignmentId), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!ar.ok) {
              console.error('Failed to add created problem to assignment');
            }
          } catch (err) {
            console.error('Failed to add created problem to assignment:', err);
          }
        }

        onCreated?.(created, true);
        resetForm();
        setOpen(false);
      } else {
        const msg = await safeMessage(res);
        const display = msg ?? `Request failed (${res.status})`;
        console.error('Failed to create problem:', display);
        // 4xx = validation/user error → show inline on the file field
        // 5xx = server error → toast only
        if (res.status >= 400 && res.status < 500) {
          setError('file', { type: 'manual', message: display });
        } else {
          showToast.error(display);
        }
      }
    } catch (error) {
      console.error('Form submission error:', error);
      if (typeof error === 'string') {
        setError('file', { type: 'manual', message: error });
        return;
      }
      if (error instanceof z.ZodError) {
        // Handle Zod validation errors
        const message = error.errors?.map((e) => e.message).join();
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
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create Problem</DialogTitle>
          <DialogDescription>
            Fill in the problem details and upload the solution file.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Title */}
          <Controller
            control={control}
            name="title"
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

          {/* Description */}
          <Controller
            control={control}
            name="description"
            render={({ field }) => (
              <div>
                <Label className="mb-2 block">Description</Label>
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  rows={4}
                  placeholder="Optional description"
                />
                {errors.description && (
                  <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>
                )}
              </div>
            )}
          />

          {/* Type */}
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <div>
                <Label className="mb-2 block">Problem Type</Label>
                <select
                  className="w-full rounded border p-2"
                  value={field.value}
                  onChange={(e) =>
                    field.onChange(e.target.value as z.infer<typeof ProblemTypeEnum>)
                  }
                >
                  <option value="FA">Finite Automaton</option>
                  <option value="PDA">Push-Down Automaton</option>
                  <option value="CFG">Context-Free Grammar</option>
                  <option value="RE">Regular Expression</option>
                </select>
              </div>
            )}
          />

          {/* Group assignment dropdown (shown only when the assignment supports groups) */}
          {assignmentIsGroup && (
            <div>
              <Label className="mb-2 block">Assign to Group</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded border p-2 text-left"
                      aria-haspopup="listbox"
                    >
                      <span className="truncate">
                        {selectedGroupId === 'ALL'
                          ? 'All students'
                          : groups.find((g) => g.id === selectedGroupId)?.name || 'Select group'}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4" />
                    </button>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-80 max-w-[90vw] p-2" align="start">
                  <div className="mb-2">
                    <div className="relative">
                      <SearchIcon className="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
                      <Input
                        className="pl-10"
                        placeholder="Search groups"
                        value={groupFilter}
                        onChange={(e) => setGroupFilter(e.target.value)}
                        autoFocus
                      />
                    </div>
                  </div>

                  <div className="bg-card max-h-64 overflow-auto rounded-md border">
                    <ul>
                      <li>
                        <button
                          type="button"
                          onClick={() => setSelectedGroupId('ALL')}
                          className={`hover:bg-primary/10 flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${
                            selectedGroupId === 'ALL' ? 'bg-primary/10' : ''
                          }`}
                        >
                          <div className="truncate">All students</div>
                          {selectedGroupId === 'ALL' && <Check className="h-4 w-4" />}
                        </button>
                      </li>
                      {groupsLoading ? (
                        <li className="text-muted-foreground p-3 text-sm">Loading…</li>
                      ) : filteredGroups.length === 0 ? (
                        <li className="text-muted-foreground p-3 text-sm">No groups available</li>
                      ) : (
                        filteredGroups.map((g) => (
                          <li key={g.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedGroupId(g.id)}
                              className={`hover:bg-primary/10 flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${
                                selectedGroupId === g.id ? 'bg-primary/10' : ''
                              }`}
                            >
                              <div className="truncate">{g.name}</div>
                              {selectedGroupId === g.id && <Check className="h-4 w-4" />}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

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

async function safeMessage(res: Response): Promise<string | null> {
  try {
    const data = await res.json();
    return (
      (data as { message?: string; error?: string })?.message ??
      (data as { message?: string; error?: string })?.error ??
      null
    );
  } catch {
    // Response wasn't JSON (e.g. Next.js HTML error page) — return null so
    // the caller can fall back to showing the HTTP status code instead.
    return null;
  }
}
