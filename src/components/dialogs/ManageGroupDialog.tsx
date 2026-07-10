'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
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
import { Badge } from '@/components/ui/RoleBadge';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';

type RawStudent = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatar?: string | null;
};

type Member = {
  id: string;
  userId: string;
  addedAt: string;
  user: RawStudent;
};

export default function ManageGroupMembersDialog({
  open,
  setOpen,
  courseId,
  group,
  onChanged,
  initialStudents,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  courseId: string;
  group: { id: string; name: string } | null;
  onChanged?: () => void;
  initialStudents?: RawStudent[];
}) {
  const queryClient = useQueryClient();
  const groupId = group?.id ?? null;

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [initialSelected, setInitialSelected] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const itemRefs = React.useRef<(HTMLLIElement | null)[]>([]);

  // Course students. Shared key with GroupsCard/AssignmentSubmissions so the
  // read dedupes / serves warm across those consumers.
  const studentsQuery = useQuery<RawStudent[]>({
    queryKey: queryKeys.course.students(courseId),
    queryFn: () => fetchJson<RawStudent[]>(apiPaths.courseStudents(courseId)),
    enabled: open && !!group,
    staleTime: 30_000,
  });

  // Group members. Keyed per group so reopening the same group is served warm.
  const membersQuery = useQuery<{ members: { userId: string }[] }>({
    queryKey: queryKeys.course.groupMembers(courseId, String(groupId)),
    queryFn: () =>
      fetchJson<{ members: { userId: string }[] }>(
        apiPaths.courseGroupMembers(courseId, String(groupId)),
      ),
    enabled: open && !!group,
    staleTime: 30_000,
  });

  // Prefer caller-preloaded students (fast-path), else the cached read.
  const rawStudents: RawStudent[] | undefined =
    initialStudents && initialStudents.length > 0 ? initialStudents : studentsQuery.data;

  const students = useMemo<Member[]>(
    () =>
      (rawStudents ?? []).map((u) => ({
        id: u.id,
        userId: u.id,
        addedAt: '',
        user: {
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          avatar: u.avatar,
        },
      })),
    [rawStudents],
  );

  // Blocking spinner off isLoading (not isFetching). When the caller preloads
  // students, only the members read gates the spinner.
  const studentsLoading =
    initialStudents && initialStudents.length > 0 ? false : studentsQuery.isLoading;

  // Cache the reads, seed the local editable selection. Rebuilds the checkbox
  // state whenever the roster or the member set changes.
  useEffect(() => {
    if (!open || !group) return;
    const members = membersQuery.data?.members;
    if (!members) return;
    const memberIds = new Set<string>(members.map((m) => m.userId));
    const sel: Record<string, boolean> = {};
    students.forEach((s) => {
      if (memberIds.has(s.userId)) sel[s.userId] = true;
    });
    setSelected(sel);
    setInitialSelected({ ...sel });
  }, [open, group, students, membersQuery.data]);

  // Surface a load error the way the old fetchData did.
  useEffect(() => {
    if (!open || !group) return;
    if (studentsQuery.isError || membersQuery.isError) {
      console.error('Fetch group members error:', studentsQuery.error ?? membersQuery.error);
      showToast.error('Failed to load members');
    }
  }, [
    open,
    group,
    studentsQuery.isError,
    membersQuery.isError,
    studentsQuery.error,
    membersQuery.error,
  ]);

  // Reset transient UI state when the dialog closes.
  useEffect(() => {
    if (!open) {
      setSelected({});
      setInitialSelected({});
      setFilter('');
      setSelectedIdx(-1);
      itemRefs.current = [];
    }
  }, [open]);

  function toggle(userId: string) {
    setSelected((prev) => ({ ...prev, [userId]: !prev[userId] }));
  }

  const filteredStudents = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      ((s.user.firstName || '') + ' ' + (s.user.lastName || '') + ' ' + (s.user.email || ''))
        .toLowerCase()
        .includes(q),
    );
  }, [students, filter]);

  React.useEffect(() => {
    if (filteredStudents.length === 0) setSelectedIdx(-1);
    else if (selectedIdx >= filteredStudents.length) setSelectedIdx(filteredStudents.length - 1);
  }, [filteredStudents, selectedIdx]);

  React.useEffect(() => {
    if (selectedIdx >= 0 && itemRefs.current[selectedIdx]) {
      itemRefs.current[selectedIdx]?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx, filteredStudents]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!filteredStudents.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => (prev < filteredStudents.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : filteredStudents.length - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (selectedIdx >= 0) {
        const target = filteredStudents[selectedIdx];
        if (target) toggle(target.userId);
      }
    }
  }

  function isDirty(a: Record<string, boolean>, b: Record<string, boolean>) {
    const aKeys = Object.keys(a)
      .filter((k) => !!a[k])
      .sort();
    const bKeys = Object.keys(b)
      .filter((k) => !!b[k])
      .sort();
    if (aKeys.length !== bKeys.length) return true;
    for (let i = 0; i < aKeys.length; i++) if (aKeys[i] !== bKeys[i]) return true;
    return false;
  }

  // Diff the checkbox selection against the loaded members and apply the adds and
  // removes in parallel. A single failed op fails the whole save.
  const { mutate: saveMembers, isPending: isSaving } = useMutation({
    mutationFn: async (target: { id: string }) => {
      const toAdd: string[] = [];
      const toRemove: string[] = [];
      for (const s of students) {
        const was = !!initialSelected[s.userId];
        const now = !!selected[s.userId];
        if (!was && now) toAdd.push(s.userId);
        if (was && !now) toRemove.push(s.userId);
      }
      const ops: Promise<unknown>[] = [
        ...toAdd.map((uid) =>
          fetchJson(apiPaths.courseGroupMembers(courseId, target.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: uid }),
          }),
        ),
        ...toRemove.map((uid) =>
          fetchJson(apiPaths.courseGroupMember(courseId, target.id, uid), { method: 'DELETE' }),
        ),
      ];
      await Promise.all(ops);
    },
    onSuccess: (_data, target) => {
      showToast.success('Members updated');
      setInitialSelected({ ...selected });
      // Re-pull the members read (reopen reflects the change) and the groups list
      // (membership counts may render there).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.course.groupMembers(courseId, target.id),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.course.groups(courseId) });
      onChanged?.();
      setOpen(false);
    },
    onError: (err) => {
      console.error('Save members error:', err);
      showToast.error('Failed to save members');
    },
  });

  const loading = isSaving || (!!group && open && (studentsLoading || membersQuery.isLoading));

  function handleSave() {
    if (!group) return;
    if (!isDirty(selected, initialSelected)) return setOpen(false);
    saveMembers({ id: group.id });
  }

  function handleCancel() {
    setSelected({ ...initialSelected });
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) handleCancel();
      }}
    >
      <DialogContent className="bg-card max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Members</DialogTitle>
          <DialogDescription>Manage students assigned to group {group?.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <InputGroup
              label="Search students"
              name="member-filter"
              placeholder="Type name or email"
              value={filter}
              setValue={setFilter}
              autoFocus
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="h-80 overflow-auto rounded-md border">
            {loading ? (
              <div className="text-muted-foreground p-3 text-center text-sm">Loading…</div>
            ) : filteredStudents.length === 0 ? (
              <div className="text-muted-foreground p-3 text-center text-sm">No students.</div>
            ) : (
              <ul>
                {filteredStudents.slice(0, 500).map((s, idx) => (
                  <li
                    key={s.userId}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                  >
                    <label
                      htmlFor={`manage-checkbox-${s.userId}`}
                      className={`hover:bg-primary/10 flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 ${selectedIdx === idx ? 'bg-primary/10' : ''}`}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      tabIndex={0}
                    >
                      <input
                        id={`manage-checkbox-${s.userId}`}
                        type="checkbox"
                        className="mr-2"
                        checked={!!selected[s.userId]}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = { ...prev };
                            if (e.target.checked) next[s.userId] = true;
                            else delete next[s.userId];
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />

                      <span className="flex flex-1 flex-col">
                        <span className="text-sm">
                          {s.user.firstName} {s.user.lastName}
                        </span>
                        <span className="text-muted-foreground text-xs">{s.user.email}</span>
                      </span>

                      <Badge role="STUDENT">Student</Badge>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="bg-card mt-4">
          <DialogClose asChild>
            <Button variant="secondary" type="button" onClick={handleCancel} disabled={loading}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSave} disabled={loading}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
