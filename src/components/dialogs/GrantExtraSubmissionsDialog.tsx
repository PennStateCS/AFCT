'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiClient } from '@/lib/api/fetch-client';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { showToast } from '@/lib/toast';
import { SubmissionGrantCreateApiSchema } from '@/schemas/assignment';

type GrantRow = {
  id: string;
  targetType: 'STUDENT' | 'GROUP';
  userId: string | null;
  groupId: string | null;
  extraSubmissions: number;
};

export type GrantExtraSubmissionsDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  assignmentId: string;
  problemId: string;
  problemTitle: string | null;
  student: { id: string; name: string };
  /** The student's group for this assignment (null on individual assignments). */
  groupId: string | null;
  groupName?: string | null;
  onGranted?: () => void;
};

const grantsKey = (courseId: string, assignmentId: string, problemId: string) =>
  ['course', courseId, 'assignment', assignmentId, 'problem', problemId, 'grants'] as const;

/**
 * Staff action: give one student (or their group) extra submissions on one problem, on
 * top of the shared cap. Additive; repeat grants accumulate. On a group assignment the
 * group is the default target, since attempts are counted group-wide there.
 */
export function GrantExtraSubmissionsDialog({
  open,
  setOpen,
  courseId,
  assignmentId,
  problemId,
  problemTitle,
  student,
  groupId,
  groupName,
  onGranted,
}: GrantExtraSubmissionsDialogProps) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<'student' | 'group'>(groupId ? 'group' : 'student');
  const [amount, setAmount] = useState('1');
  const [reason, setReason] = useState('');

  // Reset to a fresh form each time the dialog opens for a (possibly different) target.
  useEffect(() => {
    if (open) {
      setTarget(groupId ? 'group' : 'student');
      setAmount('1');
      setReason('');
    }
  }, [open, groupId, student.id, problemId]);

  const grantsQuery = useQuery({
    queryKey: grantsKey(courseId, assignmentId, problemId),
    queryFn: () =>
      apiClient.get<GrantRow[]>(apiPaths.problemSubmissionGrants(courseId, assignmentId, problemId)),
    enabled: open,
    staleTime: 30_000,
  });

  const existingForTarget = (grantsQuery.data ?? []).find((g) =>
    target === 'group' ? g.groupId === groupId : g.userId === student.id,
  );

  const grantMutation = useMutation({
    mutationFn: (body: { userId?: string; groupId?: string; extraSubmissions: number; reason?: string }) =>
      apiClient.post(apiPaths.problemSubmissionGrants(courseId, assignmentId, problemId), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: grantsKey(courseId, assignmentId, problemId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.assignment.reviewData(courseId, assignmentId, student.id),
      });
      showToast.success('Extra submissions granted');
      onGranted?.();
      setOpen(false);
    },
    onError: (err) => {
      console.error('Grant extra submissions failed:', err);
      showToast.error(err instanceof ApiError ? err.message : 'Failed to grant extra submissions');
    },
  });

  const submit = () => {
    const extraSubmissions = Number(amount);
    const body = {
      ...(target === 'group' && groupId ? { groupId } : { userId: student.id }),
      extraSubmissions,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    const parsed = SubmissionGrantCreateApiSchema.safeParse(body);
    if (!parsed.success) {
      showToast.error(parsed.error.issues[0]?.message ?? 'Enter a whole number of submissions (1-100).');
      return;
    }
    grantMutation.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Grant extra submissions</DialogTitle>
          <DialogDescription>
            {problemTitle ? `${problemTitle}: add` : 'Add'} extra attempts on top of the shared
            submission limit. Only the chosen {groupId ? 'student or group' : 'student'} gets them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {groupId ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Who receives them</legend>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="grant-target-group"
                  name="grant-target"
                  checked={target === 'group'}
                  onChange={() => setTarget('group')}
                />
                <Label htmlFor="grant-target-group">
                  The whole group{groupName ? ` (${groupName})` : ''}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="grant-target-student"
                  name="grant-target"
                  checked={target === 'student'}
                  onChange={() => setTarget('student')}
                />
                <Label htmlFor="grant-target-student">Only {student.name}</Label>
              </div>
            </fieldset>
          ) : (
            <p className="text-sm text-muted-foreground">For {student.name}.</p>
          )}

          <div className="space-y-2">
            <Label htmlFor="grant-amount">Extra submissions</Label>
            <Input
              id="grant-amount"
              type="number"
              min={1}
              max={100}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {existingForTarget ? (
              <p className="text-sm text-muted-foreground">
                Already granted: +{existingForTarget.extraSubmissions}. This adds on top.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="grant-reason">Reason (optional)</Label>
            <Textarea
              id="grant-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. submitted the wrong file"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={grantMutation.isPending}>
            {grantMutation.isPending ? 'Granting…' : 'Grant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
