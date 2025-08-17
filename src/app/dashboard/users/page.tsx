'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { User } from '@prisma/client';
import { getUserColumns } from './user-columns';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CreateUserDialog } from '@/components/dialogs/CreateUserDialog';
import { UserRoundPlus } from 'lucide-react';

export default function ViewUsersPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(searchParams.get('create') === 'open');

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error('Failed to fetch users');
      const data: User[] = await res.json();
      setUsers(data);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

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
        <CardTitle className="text-2xl">User Accounts</CardTitle>
        <Button onClick={() => setOpen(true)}>
          <UserRoundPlus />
          Create User
        </Button>
      </CardHeader>

      <CardContent>
        <DataTable columns={getUserColumns(fetchUsers)} data={users} loading={loading} />
      </CardContent>

      <CreateUserDialog open={open} setOpen={handleDialogClose} onSuccess={fetchUsers} />
    </Card>
  );
}
