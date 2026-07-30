'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RichDescriptionField } from '@/components/rich-description/RichDescriptionField';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { apiPaths } from '@/lib/api-paths';
import { showToast } from '@/lib/toast';
import type { RichDescriptionEnvelope } from '@/lib/rich-description';

/**
 * The assignment's title and description, edited on the Assignment tab. Defaults to the
 * current values and only enables Save once something changes. Saving PUTs the two fields
 * and lets the parent refresh.
 *
 * Description handling: the editor is seeded from the stored rich document when there is one,
 * otherwise from the plain text. It emits only on a real edit, so a legacy plain-text
 * assignment converts to rich JSON when the author edits the description and saves, never
 * merely because the tab was opened. A save that touches only the title re-sends whatever
 * form the description is already in.
 */
export function AssignmentBasicsForm({
  courseId,
  assignmentId,
  initialTitle,
  initialDescription,
  initialDescriptionJson,
  courseIsArchived = false,
  onSaved,
}: {
  courseId: string;
  assignmentId: string;
  initialTitle: string;
  initialDescription: string;
  /** The stored rich document, when the assignment already has one. */
  initialDescriptionJson?: RichDescriptionEnvelope | null;
  courseIsArchived?: boolean;
  onSaved?: () => void;
}) {
  const titleId = useId();
  const errorId = useId();
  const [title, setTitle] = useState(initialTitle);
  // Null means "no rich document yet": a legacy plain-text assignment the author has not
  // edited. Set either from the stored document or from the first edit.
  const [descriptionJson, setDescriptionJson] = useState<RichDescriptionEnvelope | null>(
    initialDescriptionJson ?? null,
  );
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the assignment changes (e.g. after a save refetch, or switching assignment).
  useEffect(() => {
    setTitle(initialTitle);
    setDescriptionJson(initialDescriptionJson ?? null);
    setDescriptionEdited(false);
    setError(null);
  }, [initialTitle, initialDescription, initialDescriptionJson]);

  const dirty = title !== initialTitle || descriptionEdited;

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
        // Rich JSON wins and the server derives the plain text from it. With no rich document
        // this stays a plain-text write of the existing description.
        ...(descriptionJson ? { descriptionJson } : { description: initialDescription }),
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

      {/* Remounted when the record changes so the editor reloads its initial content; it is not
          a controlled input, so a prop change alone would not replace the open document. */}
      <RichDescriptionField
        key={assignmentId}
        value={initialDescriptionJson ?? initialDescription}
        onChange={(value) => {
          setDescriptionJson(value);
          setDescriptionEdited(true);
        }}
        disabled={courseIsArchived}
        placeholder="Enter assignment description"
      />

      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
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
