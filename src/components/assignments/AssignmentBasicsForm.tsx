'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { apiPaths } from '@/lib/api-paths';
import { showToast } from '@/lib/toast';

/**
 * The assignment's title and description, edited on the Assignment tab. Defaults to the
 * current values and only enables Save once something changes. Saving PUTs the two fields
 * and lets the parent refresh.
 */
export function AssignmentBasicsForm({
  courseId,
  assignmentId,
  initialTitle,
  initialDescription,
  courseIsArchived = false,
  onSaved,
}: {
  courseId: string;
  assignmentId: string;
  initialTitle: string;
  initialDescription: string;
  courseIsArchived?: boolean;
  onSaved?: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const errorId = useId();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the assignment changes (e.g. after a save refetch, or switching assignment).
  useEffect(() => {
    setTitle(initialTitle);
    setDescription(initialDescription);
    setError(null);
  }, [initialTitle, initialDescription]);

  const dirty = title !== initialTitle || description !== initialDescription;

  const save = async () => {
    const trimmed = title.trim();
    if (trimmed.length < 3) {
      setError('Title must be at least 3 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.put(apiPaths.assignment(courseId, assignmentId), {
        title: trimmed,
        description,
      });
      showToast.success('Assignment updated');
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save the assignment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={titleId}>Title</Label>
        <Input
          id={titleId}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          disabled={courseIsArchived}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={descId}>Description</Label>
        <Textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Enter assignment description"
          className="min-h-40"
          disabled={courseIsArchived}
        />
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !dirty || courseIsArchived}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
