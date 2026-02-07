'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Users } from 'lucide-react';
import { formatDateTimeInTimeZone } from '@/lib/date';
import { ColumnDef } from '@tanstack/react-table';
import { Group } from '@prisma/client';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { CreateGroupDialog } from '@/components/dialogs/CreateGroupsDialog';
import { EditGroupDialog } from '@/components/dialogs/EditGroupsDialog';
import ManageGroupMembersDialog from '@/components/dialogs/ManageGroupDialog';
import RandomGroupsDialog from '@/components/dialogs/RandomGroupsDialog';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

export function GroupsCard({ courseId, courseIsArchived }: { courseId: string; courseIsArchived?: boolean }) {
  const { timezone } = useEffectiveTimezone();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [randomOpen, setRandomOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [managingGroup, setManagingGroup] = useState<Group | null>(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/groups`);
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed to load groups');
      const data = await res.json();
      setGroups(data);
    } catch (err) {
      console.error('Fetch groups error:', err);
      showToast.error('Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/students`);
        if (!res.ok) throw new Error((await res.json())?.error || 'Failed to load students');
        const body = await res.json();
        if (!mounted) return;
        setStudents(body);
      } catch (err) {
        console.error('Fetch students error:', err);
      }
    })();
    return () => { mounted = false; };
  }, [courseId]);

  const handleDelete = async () => {
    if (!deletingGroup) return;
    try {
      const res = await fetch(`/api/courses/${courseId}/groups/${deletingGroup.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast.error(body.error || 'Failed to delete group');
        return;
      }
      showToast.success('Group deleted');
      setConfirmOpen(false);
      setDeletingGroup(null);
      fetchGroups();
    } catch (err) {
      console.error('Delete group error:', err);
      showToast.error('Failed to delete group');
    }
  };

  const columns = useMemo<ColumnDef<Group, any>[]>(() => [
    { accessorKey: 'name', header: 'Name', meta: { priority: 1 } },
    { accessorKey: 'createdAt', header: 'Created At', meta: { priority: 3 }, cell: ({ row }) => formatDateTimeInTimeZone((row.original as any).createdAt, timezone) },

    { id: 'manage', header: 'Manage Users', meta: { priority: 1 }, cell: ({ row }) => {
      const g = row.original as Group;
      return (
        <Button variant="secondary" onClick={() => { setManagingGroup(g); setManageOpen(true); }}>
          Manage
        </Button>
      );
    } },

    { id: 'edit', header: 'Edit', meta: { priority: 1 }, cell: ({ row }) => {
      const g = row.original as Group;
      return (
        <Button variant="secondary" onClick={() => { setEditingGroup(g); setEditOpen(true); }} disabled={!!courseIsArchived} title={courseIsArchived ? 'Cannot edit group in archived course' : undefined}>
          Edit
        </Button>
      );
    } },

    { id: 'delete', header: 'Delete', meta: { priority: 1 }, cell: ({ row }) => {
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
    } },
  ], [timezone, courseIsArchived]);

  return (
    <Card className="p-4">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-2xl flex items-center gap-2"><Users className="h-5 w-5" />Groups</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={() => setCreateOpen(true)} hidden={courseIsArchived}>
            <Plus /> Create Group
          </Button>
          <Button variant="default" onClick={() => setRandomOpen(true)} hidden={courseIsArchived}>
            <Plus /> Random Groups
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <DataTable columns={columns} data={groups} loading={loading} />
      </CardContent>

      <CreateGroupDialog open={createOpen} setOpen={setCreateOpen} courseId={courseId} onSuccess={fetchGroups} />
      <RandomGroupsDialog open={randomOpen} setOpen={setRandomOpen} courseId={courseId} students={students} onCreated={fetchGroups} />
      <EditGroupDialog open={editOpen} setOpen={setEditOpen} group={editingGroup ?? undefined} courseId={courseId} onSuccess={fetchGroups} />
      <ManageGroupMembersDialog open={manageOpen} setOpen={setManageOpen} courseId={courseId} group={managingGroup ?? null} onChanged={fetchGroups} initialStudents={students} />

      <ConfirmDialog open={confirmOpen} onCancel={() => setConfirmOpen(false)} onConfirm={handleDelete} title="Delete Group" description={`Are you sure you want to delete group ${deletingGroup?.name}?`} confirmText="Delete" cancelText="Cancel" />
    </Card>
  );
}

export default GroupsCard;
