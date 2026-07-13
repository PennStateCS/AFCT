'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Users } from 'lucide-react';
import { formatDateTimeInTimeZone } from '@/lib/date';
import type { ColumnDef } from '@tanstack/react-table';
import type { Group } from '@prisma/client';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { CreateGroupDialog } from '@/components/dialogs/CreateGroupsDialog';
import { EditGroupDialog } from '@/components/dialogs/EditGroupsDialog';
import ManageGroupMembersDialog from '@/components/dialogs/ManageGroupDialog';
import RandomGroupsDialog from '@/components/dialogs/RandomGroupsDialog';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';

type CourseStudent = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatar?: string | null;
};

// Stable empty defaults so values derived from the queries keep a constant
// identity between renders (keeps the memoized table data / dialogs stable).
const EMPTY_GROUPS: Group[] = [];
const EMPTY_STUDENTS: CourseStudent[] = [];

export function GroupsCard({
  courseId,
  courseIsArchived,
}: {
  courseId: string;
  courseIsArchived?: boolean;
}) {
  const { timezone } = useEffectiveTimezone();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [randomOpen, setRandomOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [managingGroup, setManagingGroup] = useState<Group | null>(null);

  // Cached groups list, read via GET /api/courses/{id}/groups.
  const groupsQuery = useQuery({
    queryKey: queryKeys.course.groups(courseId),
    queryFn: async () => {
      const data = await fetchJson<Group[] | { groups?: Group[] }>(apiPaths.courseGroups(courseId));
      return (Array.isArray(data) ? data : (data?.groups ?? [])) as Group[];
    },
    staleTime: 30_000,
  });
  const groups = groupsQuery.data ?? EMPTY_GROUPS;
  const loading = groupsQuery.isPending;

  // Seed the students query from a course view already in the cache. The course
  // page caches the course under ['course', courseId, <view>] with an `enrolled`
  // array of user objects tagged with `courseRole`; the STUDENT-role subset maps
  // exactly onto what GET /api/courses/{id}/students returns (id/first/last/email,
  // plus the harmless optional avatar). Both the base `summary` view (always warm
  // on mount) and the `roster` view carry `enrolled`, so we check both. Returns
  // undefined when no roster-bearing view is cached, so the query fetches normally.
  const seededStudents = useMemo<CourseStudent[] | undefined>(() => {
    for (const view of ['roster', 'summary'] as const) {
      const cached = queryClient.getQueryData(queryKeys.course.view(courseId, view)) as
        | { enrolled?: Array<Record<string, unknown>> }
        | undefined;
      const enrolled = cached?.enrolled;
      if (!Array.isArray(enrolled)) continue;
      return enrolled
        .filter((u) => u.courseRole === 'STUDENT')
        .map((u) => ({
          id: String(u.id),
          firstName: (u.firstName ?? null) as string | null,
          lastName: (u.lastName ?? null) as string | null,
          email: (u.email ?? null) as string | null,
          avatar: (u.avatar ?? null) as string | null,
        }));
    }
    return undefined;
    // courseId is the only input that changes the cache lookup; the cache itself
    // isn't reactive, so we intentionally read it once per courseId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // Cached course students (a plain GET). When the roster is already in the
  // course cache we seed from it (initialData) and skip the network round-trip.
  const studentsQuery = useQuery({
    queryKey: queryKeys.course.students(courseId),
    queryFn: () => fetchJson<CourseStudent[]>(apiPaths.courseStudents(courseId)),
    initialData: seededStudents,
    staleTime: 30_000,
  });
  const students = studentsQuery.data ?? EMPTY_STUDENTS;

  // Re-pull the groups list after a mutation succeeds; the query refetches
  // because it's active.
  const refreshGroups = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.course.groups(courseId) }),
    [queryClient, courseId],
  );

  const { mutate: deleteGroup } = useMutation({
    mutationFn: (group: Group) =>
      fetchJson(apiPaths.courseGroup(courseId, group.id), { method: 'DELETE' }),
    onSuccess: () => {
      showToast.success('Group deleted');
      setConfirmOpen(false);
      setDeletingGroup(null);
      void refreshGroups();
    },
    onError: (err) => {
      console.error('Delete group error:', err);
      showToast.error(err instanceof Error ? err.message : 'Failed to delete group');
    },
  });

  const handleDelete = () => {
    if (deletingGroup) deleteGroup(deletingGroup);
  };

  const columns = useMemo<ColumnDef<Group>[]>(
    () => [
      { accessorKey: 'name', header: 'Name', meta: { priority: 1 } },
      {
        accessorKey: 'createdAt',
        header: 'Created At',
        meta: { priority: 3 },
        cell: ({ row }) => formatDateTimeInTimeZone(row.original.createdAt, timezone),
      },

      {
        id: 'manage',
        header: 'Manage Users',
        meta: { priority: 1 },
        cell: ({ row }) => {
          const g = row.original as Group;
          return (
            <Button
              variant="secondary"
              onClick={() => {
                setManagingGroup(g);
                setManageOpen(true);
              }}
            >
              Manage
            </Button>
          );
        },
      },

      {
        id: 'edit',
        header: 'Edit',
        meta: { priority: 1 },
        cell: ({ row }) => {
          const g = row.original as Group;
          return (
            <Button
              variant="secondary"
              onClick={() => {
                setEditingGroup(g);
                setEditOpen(true);
              }}
              disabled={!!courseIsArchived}
              title={courseIsArchived ? 'Cannot edit group in archived course' : undefined}
            >
              Edit
            </Button>
          );
        },
      },

      {
        id: 'delete',
        header: 'Delete',
        meta: { priority: 1 },
        cell: ({ row }) => {
          const g = row.original as Group;
          return (
            <Button
              variant="destructive"
              onClick={() => {
                if (courseIsArchived) return;
                setDeletingGroup(g);
                setConfirmOpen(true);
              }}
              disabled={!!courseIsArchived}
              title={courseIsArchived ? 'Cannot delete group from archived course' : undefined}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          );
        },
      },
    ],
    [timezone, courseIsArchived],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <Users className="h-5 w-5" />
          Groups
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={() => setCreateOpen(true)} hidden={courseIsArchived}>
            <Plus /> Create Group
          </Button>
          <Button variant="default" onClick={() => setRandomOpen(true)} hidden={courseIsArchived}>
            <Plus /> Random Groups
          </Button>
        </div>
      </div>

      <DataTable columns={columns} data={groups} loading={loading} />

      <CreateGroupDialog
        open={createOpen}
        setOpen={setCreateOpen}
        courseId={courseId}
        onSuccess={refreshGroups}
      />
      <RandomGroupsDialog
        open={randomOpen}
        setOpen={setRandomOpen}
        courseId={courseId}
        students={students}
        onCreated={refreshGroups}
      />
      <EditGroupDialog
        open={editOpen}
        setOpen={setEditOpen}
        group={editingGroup ?? undefined}
        courseId={courseId}
        onSuccess={refreshGroups}
      />
      <ManageGroupMembersDialog
        open={manageOpen}
        setOpen={setManageOpen}
        courseId={courseId}
        group={managingGroup ?? null}
        onChanged={refreshGroups}
        initialStudents={students}
      />

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete Group"
        description={`Are you sure you want to delete group ${deletingGroup?.name}?`}
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}

export default GroupsCard;
