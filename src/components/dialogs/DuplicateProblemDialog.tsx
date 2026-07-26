'use client';

import React, { useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import type { Problem } from '@prisma/client';

export type DuplicateSourceProblem = {
  id: string;
  title: string;
  description?: string | null;
};

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  problem: DuplicateSourceProblem | null;
  onDuplicated?: (created: Problem) => void;
};

/**
 * Duplicate an existing problem. Mirrors the Details step of the Duplicate Assignment
 * wizard: only the title/description are editable; the type, state cap, determinism
 * flag, and the solution file are copied from the source and editable afterward.
 */
export function DuplicateProblemDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  problem,
  onDuplicated,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Prefill from the source whenever the dialog opens (or targets a different problem).
  useEffect(() => {
    if (open && problem) {
      setTitle(problem.title);
      setDescription(problem.description ?? '');
      setSubmitting(false);
    }
  }, [open, problem]);

  const titleError = title.trim().length < 3 ? 'Title must be at least 3 characters.' : undefined;

  const handleCreate = async () => {
    if (!problem || titleError) return;
    setSubmitting(true);
    try {
      const created = await apiClient.post<Problem>(
        apiPaths.courseProblemDuplicate(courseId, problem.id),
        { title: title.trim(), description: description.trim() ? description.trim() : null },
      );
      showToast.success('Problem duplicated');
      onDuplicated?.(created);
      setOpen(false);
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to duplicate problem');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Duplicate Problem</DialogTitle>
          <DialogDescription className="sr-only">
            Duplicate this problem: edit its title and description, then create the copy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="dup-problem-title" className="mb-2 block">
              Title
            </Label>
            <Input
              id="dup-problem-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={!!titleError}
              aria-describedby={titleError ? 'dup-problem-title-error' : undefined}
              placeholder="Problem title"
            />
            {titleError && (
              <p id="dup-problem-title-error" className="mt-1 text-xs text-red-600" role="alert">
                {titleError}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="dup-problem-description" className="mb-2 block">
              Description
            </Label>
            <Textarea
              id="dup-problem-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter problem description"
              className="min-h-[120px]"
            />
          </div>
          <p className="text-muted-foreground text-xs">
            The solution file and the other settings (type, state limit, and determinism) are copied
            from the original. You can edit the remaining details after the copy is created.
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={submitting || courseIsArchived || !!titleError}
          >
            {submitting ? 'Duplicating…' : 'Create Duplicate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
