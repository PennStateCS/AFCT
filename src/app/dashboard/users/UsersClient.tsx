'use client';

import React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getUserColumns } from './user-columns';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CreateUserDialog } from '@/components/dialogs/CreateUserDialog';
import { ImportUsersDialog } from '@/components/dialogs/ImportUsersDialog';
import { UserRoundPlus, Users } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { UserListItem } from '@/lib/users-list';

export default function UsersClient({ initialUsers }: { initialUsers?: UserListItem[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasInitialUsers = Array.isArray(initialUsers);

  const [users, setUsers] = useState<UserListItem[]>(initialUsers ?? []);
  const [loading, setLoading] = useState(!hasInitialUsers);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(searchParams.get('create') === 'open');
  const [importOpen, setImportOpen] = useState(false);
  const { timezone } = useEffectiveTimezone();

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await fetch('/api/users/list', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch users');
      const data: UserListItem[] = await res.json();
      setUsers(data);
    } catch (error) {
      setLoadError('Failed to load users. Please try again.');
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasInitialUsers) {
      void fetchUsers();
    }
  }, [fetchUsers, hasInitialUsers]);

  const columns = useMemo(() => getUserColumns(fetchUsers, timezone), [fetchUsers, timezone]);

  const handleDialogClose = (value: boolean) => {
    setOpen(value);
    if (!value) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('create');
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  };

  return (
    <Card className="p-4">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle role="heading" aria-level={1} className="text-2xl">
          User Accounts
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Users />
            Import Users
          </Button>
          <Button onClick={() => setOpen(true)}>
            <UserRoundPlus />
            Create User
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {loadError ? (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2">
            <p role="alert" className="text-sm text-red-700">
              {loadError}
            </p>
            <Button variant="outline" size="sm" onClick={() => void fetchUsers()}>
              Retry
            </Button>
          </div>
        ) : null}

        <DataTable
          columns={columns}
          data={users}
          loading={loading}
          tableLabel="Users table"
          defaultColumnVisibility={{ createdAt: false }}
        />
      </CardContent>

      <CreateUserDialog open={open} setOpen={handleDialogClose} onSuccess={fetchUsers} />
      <ImportUsersDialog open={importOpen} setOpen={setImportOpen} onSuccess={fetchUsers} />
    </Card>
  );
}
