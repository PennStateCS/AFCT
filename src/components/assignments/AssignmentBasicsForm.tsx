'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RichDescriptionField } from '@/components/rich-description/RichDescriptionField';
import { SettingsSection } from '@/components/settings/settings-layout';
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
 *
 * Laid out in the shared settings panel, the same one the course Settings tab and System
 * Settings use, so a professor meets one form grammar across the three. It was a bare
 * max-w-2xl stack before, which is a third width on a page that already had two.
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

  // Re-seed the title when the stored value genuinely changes, keyed on the value rather than the
  // object so a re-render alone is not a change.
  useEffect(() => {
    setTitle(initialTitle);
    setError(null);
  }, [assignmentId, initialTitle]);

  /**
   * Re-seed the description only when the assignment itself changes.
   *
   * Clearing the baseline means waiting for the editor to report a new one, and it only reports on
   * creation, so this is correct exactly when the editor is remounted: on `assignmentId`, which is
   * its key. Keying this on the stored content instead stranded the form after a save, because a
   * save refetches new content without remounting the editor, so the baseline was cleared and
   * never replaced: Save stayed disabled through every later edit, and since the form also looked
   * pristine, leaving the page did not warn. Rebaselining after a save is `save`'s job, below.
   */
  useEffect(() => {
    setDescriptionJson(initialDescriptionJson ?? null);
    setLoadedKey(null);
    setCurrentKey(null);
    // initialDescriptionJson is deliberately absent: it is a new object on every render, and
    // depending on the object itself is the bug this replaces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

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
      // What was just sent is now what is stored, so that becomes the baseline. The refetch cannot
      // do this: the editor keeps its document across it and only reports a baseline when it is
      // remounted. Reading the key captured by this render is the point, not a stale read; edits
      // made while the save was in flight were not part of it and stay unsaved.
      setLoadedKey(currentKey);
      showToast.updated('Assignment', { name: trimmed });
      onSaved?.();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not save the assignment. Check your connection and try again.',
      );
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  return (
    // No width of its own: the tab already gives every form section a max-w-3xl measure,
    // which is the same one the settings vocabulary calls SETTINGS_COMPACT and picks for a
    // form this short. A second cap here would only be a number to keep in step with it.
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <SettingsSection
        title="Title and description"
        description="What students see at the top of the assignment."
        headingLevel={3}
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

        {/* Remounted when the record changes so the editor reloads its initial content; it is
              not a controlled input, so a prop change alone would not replace the open document. */}
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
          /*
           * Taller than the editor's default, because this is a page and not a dialog. The
           * default 160px box (115px of writing area, about five lines) is sized for the
           * problem dialogs, where the editor competes with a file picker and a set of
           * limits for a fixed amount of room. Here the description IS the tab, and that box
           * left an assignment brief being written through a slot with 400px of empty page
           * under it. 288px is about eleven lines; the drag grip still takes it further, up
           * to 80vh.
           */
          minHeightClassName="min-h-72"
        />

        {error && (
          <p id={errorId} role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </SettingsSection>

      {/* The same footer the other settings forms use: a rule, then the action at the
            form's right edge. */}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        <Button type="submit" disabled={busy || !dirty || courseIsArchived}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
