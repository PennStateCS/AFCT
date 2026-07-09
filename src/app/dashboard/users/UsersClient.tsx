'use client';

import React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getUserColumns } from './user-columns';
import { DataTable } from '@/components/ui/data-table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CreateUserDialog } from '@/components/dialogs/CreateUserDialog';
import { ImportUsersDialog } from '@/components/dialogs/ImportUsersDialog';
import { UserRoundPlus, Users } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import type { UserListItem } from '@/lib/users-list';

export default function UsersClient({ initialUsers }: { initialUsers?: UserListItem[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [open, setOpen] = useState(searchParams.get('create') === 'open');
  const [importOpen, setImportOpen] = useState(false);
  const [onlyActive, setOnlyActive] = useState(false);
  const { timezone } = useEffectiveTimezone();

  // Cached user list — survives navigation and dedupes across the dashboard. The
  // SSR-provided list seeds the cache and is treated as fresh, so there's no
  // refetch on mount when the server already sent the data.
  const {
    data: users = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const res = await fetch(apiPaths.admin.usersList(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch users');
      return (await res.json()) as UserListItem[];
    },
    initialData: initialUsers,
    staleTime: 30_000,
  });

  const activeUsers = useMemo(() => users.filter((item) => !item.inactive), [users]);
  // Stable refresh handler passed to the table + dialogs (refetch is referentially
  // stable, so table columns stay memoized across unrelated re-renders).
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const columns = useMemo(() => getUserColumns(refresh, timezone), [refresh, timezone]);

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
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={onlyActive} onCheckedChange={(value) => setOnlyActive(!!value)} />
            <span className="text-sm font-medium">Show only active users</span>
          </label>
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
        {isError ? (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2">
            <p role="alert" className="text-sm text-red-700">
              Failed to load users. Please try again.
            </p>
            <Button variant="outline" size="sm" onClick={refresh}>
              Retry
            </Button>
          </div>
        ) : null}

        <DataTable
          columns={columns}
          data={onlyActive ? activeUsers : users}
          loading={isLoading}
          tableLabel="Users table"
          defaultColumnVisibility={{ createdAt: false }}
        />
      </CardContent>

      <CreateUserDialog open={open} setOpen={handleDialogClose} onSuccess={refresh} />
      <ImportUsersDialog open={importOpen} setOpen={setImportOpen} onSuccess={refresh} />
    </Card>
  );
}
