'use client';

import React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import { getUserColumns } from './user-columns';
import { DataTable } from '@/components/ui/data-table';
import { DataTableFilterMenu } from '@/components/ui/data-table-faceted-filter';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CreateUserDialog } from '@/components/dialogs/CreateUserDialog';
import { ImportUsersDialog } from '@/components/dialogs/ImportUsersDialog';
import { UserRoundPlus, Users } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import type { UserListItem } from '@/lib/users-list';

const DEFAULT_PAGE_SIZE = 10;

// Search scope (server-side): restrict the text search to one field.
const SEARCH_FIELDS = [
  { value: 'all', label: 'All fields' },
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName', label: 'Last Name' },
  { value: 'email', label: 'Email' },
];

export default function UsersClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [open, setOpen] = useState(searchParams.get('create') === 'open');
  const [importOpen, setImportOpen] = useState(false);
  const { timezone } = useEffectiveTimezone();

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // searchInput is what the user is typing; search is the committed (debounced) query.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');

  // Multi-select filters (server-side). Values match the API's query tokens.
  const [admin, setAdmin] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [lock, setLock] = useState<string[]>([]);
  const [temp, setTemp] = useState<string[]>([]);

  const [sorting, setSorting] = useState<SortingState>([{ id: 'lastName', desc: false }]);

  // Debounce typing, and jump back to the first page when the query changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const sort = sorting[0];
  const queryParams = {
    page: pageIndex + 1,
    pageSize,
    q: search || undefined,
    field: searchField !== 'all' ? searchField : undefined,
    admin,
    status,
    lock,
    temp,
    sortBy: sort?.id,
    sortDir: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
  };

  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'users', queryParams],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(queryParams.page),
        pageSize: String(queryParams.pageSize),
      });
      if (queryParams.q) params.set('q', queryParams.q);
      if (queryParams.field) params.set('field', queryParams.field);
      queryParams.admin.forEach((v) => params.append('admin', v));
      queryParams.status.forEach((v) => params.append('status', v));
      queryParams.lock.forEach((v) => params.append('lock', v));
      queryParams.temp.forEach((v) => params.append('temp', v));
      if (queryParams.sortBy) params.set('sortBy', queryParams.sortBy);
      if (queryParams.sortDir) params.set('sortDir', queryParams.sortDir);

      const res = await fetch(`${apiPaths.admin.usersList()}?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to fetch users');
      return (await res.json()) as { rows: UserListItem[]; total: number };
    },
    placeholderData: keepPreviousData,
  });

  const users = data?.rows ?? [];
  const total = data?.total ?? 0;

  // Stable refresh passed to the table + dialogs (a mutation reloads the current page).
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const columns = useMemo(() => getUserColumns(refresh, timezone), [refresh, timezone]);

  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater;
    setPageIndex(next.pageIndex);
    setPageSize(next.pageSize);
  };

  // Sorting is server-side; changing it resets to the first page.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    setSorting(next);
    setPageIndex(0);
  };

  // A filter change resets to the first page (the result set shifts under you).
  const onFilter = (setter: (v: string[]) => void) => (v: string[]) => {
    setter(v);
    setPageIndex(0);
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

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
          data={users}
          loading={isLoading}
          tableLabel="Users table"
          showExportButton={false}
          defaultColumnVisibility={{ isAdmin: false, lockStatus: false }}
          actionButtons={
            <DataTableFilterMenu
              groups={[
                {
                  key: 'admin',
                  label: 'Admin',
                  options: [
                    { label: 'Admin', value: 'true' },
                    { label: 'Standard', value: 'false' },
                  ],
                  selected: admin,
                  onChange: onFilter(setAdmin),
                },
                {
                  key: 'status',
                  label: 'Status',
                  options: [
                    { label: 'Active', value: 'active' },
                    { label: 'Inactive', value: 'inactive' },
                  ],
                  selected: status,
                  onChange: onFilter(setStatus),
                },
                {
                  key: 'lock',
                  label: 'Lock',
                  options: [
                    { label: 'Locked', value: 'locked' },
                    { label: 'Not locked', value: 'unlocked' },
                  ],
                  selected: lock,
                  onChange: onFilter(setLock),
                },
                {
                  key: 'temp',
                  label: 'Password Status',
                  options: [
                    { label: 'Temporary', value: 'true' },
                    { label: 'Normal', value: 'false' },
                  ],
                  selected: temp,
                  onChange: onFilter(setTemp),
                },
              ]}
            />
          }
          manualPagination
          pageCount={pageCount}
          rowCount={total}
          pagination={{ pageIndex, pageSize }}
          onPaginationChange={handlePaginationChange}
          manualFiltering
          globalFilter={searchInput}
          onGlobalFilterChange={setSearchInput}
          searchScopeOptions={SEARCH_FIELDS}
          searchScope={searchField}
          onSearchScopeChange={(v) => {
            setSearchField(v);
            setPageIndex(0);
          }}
          manualSorting
          sorting={sorting}
          onSortingChange={handleSortingChange}
        />
      </CardContent>

      <CreateUserDialog open={open} setOpen={handleDialogClose} onSuccess={refresh} />
      <ImportUsersDialog open={importOpen} setOpen={setImportOpen} onSuccess={refresh} />
    </Card>
  );
}
