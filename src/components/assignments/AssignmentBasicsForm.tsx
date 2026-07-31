'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RichDescriptionField } from '@/components/rich-description/RichDescriptionField';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { apiPaths } from '@/lib/api-paths';
import { showToast } from '@/lib/toast';
import { serializeRichDescription, type RichDescriptionEnvelope } from '@/lib/rich-description';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes/UnsavedChangesProvider';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The stored document as a stable string.
   *
   * It has to be content-derived, not object-derived. The page renders this form with
   * `initialDescriptionJson={asRichDescription(assignment.descriptionJson)}`, and that runs a Zod
   * parse on every render, so the prop is a NEW object each time with identical contents. An
   * effect that depended on it re-ran on every parent render, and it cleared the dirty flag.
   *
   * That is what made equations look broken while typing looked fine: typing re-marks the form
   * dirty on the next keystroke, so a wiped flag was invisible. Inserting an equation emits once,
   * and the very next render of the page threw the edit away.
   */
  const initialKey = serializeRichDescription(initialDescriptionJson);

  /**
   * What the editor loaded, in the editor's own terms.
   *
   * Tiptap normalises what it parses, so the stored JSON and the document holding exactly that
   * content are not textually identical. Comparing against the stored value would leave an undone
   * edit looking like a change forever. The editor reports its loaded document once, and that is
   * the thing to compare against. Until it does, fall back to the stored value so a change
   * arriving early is never missed.
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);

  // Re-seed when the assignment genuinely changes (a save refetch with new content, or switching
  // assignment), keyed on values rather than identities so a re-render alone is not a change.
  useEffect(() => {
    setTitle(initialTitle);
    setDescriptionJson(initialDescriptionJson ?? null);
    setLoadedKey(null);
    setCurrentKey(null);
    setError(null);
    // initialDescriptionJson is deliberately absent: initialKey is its content, and depending on
    // the object itself is exactly the bug this replaces (a new identity every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, initialTitle, initialDescription, initialKey]);

  /**
   * Dirty means the current values differ from the stored ones, not "an edit event happened".
   *
   * A boolean flag cannot answer "did they undo it again", and undo is ordinary here: insert an
   * equation, think better of it, Ctrl+Z. Comparing content means the form goes back to pristine
   * on its own, and no longer depends on catching every edit exactly once.
   */
  const descriptionChanged = loadedKey !== null && currentKey !== null && currentKey !== loadedKey;
  const dirty = title !== initialTitle || descriptionChanged;

  // Leaving the page with pending edits asks first. Stays registered while a save is in flight
  // (the values still differ until the refetch reseeds the form), so a navigation racing a save
  // is still challenged; a successful save reseeds, the comparison goes pristine, and the guard
  // releases itself. An archived course cannot be edited, so it never registers.
  useUnsavedChangesGuard(dirty && !courseIsArchived);

  /**
   * One save at a time, tracked in a ref rather than the `busy` state.
   *
   * Two submits in the same tick both read the same render's `busy`, so a state flag lets the
   * second through and the record is PUT twice. A ref updates immediately. Grade-bearing records
   * are not somewhere to leave duplicate writes to luck.
   */
  const savingRef = useRef(false);

  const save = async () => {
    if (savingRef.current) return;
    const trimmed = title.trim();
    if (trimmed.length < 3) {
      setError('Title must be at least 3 characters.');
      return;
    }
    savingRef.current = true;
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
      savingRef.current = false;
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
          setCurrentKey(serializeRichDescription(value));
        }}
        onDocumentReady={(value) => {
          const key = serializeRichDescription(value);
          setLoadedKey(key);
          setCurrentKey(key);
        }}
        disabled={courseIsArchived}
        placeholder="Enter assignment description"
      />

      {error && (
        <p id={errorId} role="alert" className="text-destructive text-xs">
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
