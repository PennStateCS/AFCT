'use client';

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
import SwitchField from '@/components/ui/SwitchField';
import { LimitField } from '@/components/ui/LimitField';

import { useEffect, useState } from 'react';

import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';

export type AssignmentProblemSettings = {
  maxPoints: number;
  // -1 means unlimited; otherwise the accepted-submission limit (>= 1).
  maxSubmissions: number;
  autograderEnabled: boolean;
};

type AssignmentProblemSettingsDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  assignmentId: string;
  problemId: string;
  problemTitle: string;
  settings: AssignmentProblemSettings;
  courseIsArchived: boolean;
  onSaved?: () => void;
};

/**
 * Edits how one problem counts inside one assignment: points, accepted-submission cap
 * (unlimited or a number), and whether it is autograded. These live on the
 * AssignmentProblem link, so the same problem can have different values in each
 * assignment. The problem definition itself is edited in the course problem bank.
 */
export function AssignmentProblemSettingsDialog({
  open,
  setOpen,
  courseId,
  assignmentId,
  problemId,
  problemTitle,
  settings,
  courseIsArchived,
  onSaved,
}: AssignmentProblemSettingsDialogProps) {
  const [maxPoints, setMaxPoints] = useState<string>(String(settings.maxPoints ?? 0));
  const [unlimited, setUnlimited] = useState<boolean>(settings.maxSubmissions === -1);
  const [maxSubmissions, setMaxSubmissions] = useState<string>(
    settings.maxSubmissions === -1 ? '' : String(settings.maxSubmissions),
  );
  const [autograderEnabled, setAutograderEnabled] = useState<boolean>(settings.autograderEnabled);
  const [saving, setSaving] = useState(false);

  // Re-seed from the passed settings each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setMaxPoints(String(settings.maxPoints ?? 0));
    setUnlimited(settings.maxSubmissions === -1);
    setMaxSubmissions(settings.maxSubmissions === -1 ? '' : String(settings.maxSubmissions));
    setAutograderEnabled(settings.autograderEnabled);
    setSaving(false);
  }, [open, settings]);

  const pointsValue = Number(maxPoints);
  const pointsInvalid = !Number.isFinite(pointsValue) || pointsValue < 0;
  const submissionsValue = Number(maxSubmissions);
  const submissionsInvalid =
    !unlimited && (!Number.isInteger(submissionsValue) || submissionsValue < 1);
  const canSave = !pointsInvalid && !submissionsInvalid && !saving && !courseIsArchived;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await apiClient.put(apiPaths.assignmentProblem(courseId, assignmentId, problemId), {
        maxPoints: Math.max(0, pointsValue),
        maxSubmissions: unlimited ? -1 : Math.max(1, Math.floor(submissionsValue)),
        autograderEnabled,
      });
      showToast.success('Settings updated.');
      onSaved?.();
      setOpen(false);
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Problem Settings</DialogTitle>
          <DialogDescription>
            How &ldquo;{problemTitle}&rdquo; counts in this assignment. These apply to this
            assignment only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <InputGroup
            label="Max Points"
            name="assignment-problem-max-points"
            type="number"
            min={0}
            step="1"
            value={maxPoints}
            setValue={setMaxPoints}
            error={pointsInvalid ? 'Max points must be zero or greater.' : undefined}
          />

          <LimitField
            label="Accepted Submissions"
            name="assignment-problem-max-submissions"
            unlimited={unlimited}
            onUnlimitedChange={setUnlimited}
            value={maxSubmissions}
            onValueChange={setMaxSubmissions}
            min={1}
            placeholder="e.g. 5"
            error={submissionsInvalid ? 'Enter a number of at least 1, or choose Unlimited.' : undefined}
          />

          <SwitchField
            label="Automatically Graded"
            name="assignment-problem-autograder"
            id="assignment-problem-autograder"
            checked={autograderEnabled}
            onCheckedChange={(checked) => setAutograderEnabled(!!checked)}
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
