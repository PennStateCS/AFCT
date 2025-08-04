'use client';

import { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Pencil, Trash2 } from 'lucide-react';
import { User } from '@prisma/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EditUserDialog } from '@/components/dialogs/EditUserDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/RoleBadge';
import { useState } from 'react';

type ActionsCellProps = {
  user: User;
  onChange: () => void; // ✅ callback to refresh data
};

function ActionsCell({ user, onChange }: ActionsCellProps) {
  const [open, setOpen] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Remove ${user.firstName} ${user.lastName}?`)) return;
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
    if (res.ok) onChange();
  };

  const handleSave = async (updatedUser: User) => {
    const res = await fetch(`/api/users/${updatedUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedUser),
    });
    if (res.ok) onChange();
    setOpen(false);
  };

  return (
    <div className="flex gap-2">
      <EditUserDialog user={user} open={open} setOpen={setOpen} onSave={handleSave} />

      <Button
        className="flex w-10 items-center justify-center"
        variant="default"
        onClick={() => setOpen(true)}
        aria-label="Edit User"
      >
        <Pencil className="h-5 w-5" />
      </Button>

      <Button
        variant="destructive"
        className="flex w-10 items-center justify-center"
        onClick={handleDelete}
        aria-label="Remove User"
      >
        <Trash2 className="h-5 w-5" />
      </Button>
    </div>
  );
}

export const userColumns = (onChange: () => void): ColumnDef<User>[] => [
  {
    id: 'avatar',
    header: '',
    cell: ({ row }) => {
      const user = row.original;
      const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase();
      return (
        <Avatar className="h-10 w-10">
          <AvatarImage
            src={user.avatar ? `/uploads/${user.avatar}` : undefined}
            alt={`${user.firstName} ${user.lastName}`}
          />
          <AvatarFallback className="bg-secondary text-secondary-foreground">
            {initials || 'U'}
          </AvatarFallback>
        </Avatar>
      );
    },
  },
  {
    accessorKey: 'firstName',
    header: 'First Name',
  },
  {
    accessorKey: 'lastName',
    header: 'Last Name',
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => {
      const email = row.original.email;
      return (
        <a href={`mailto:${email}`} className="text-blue-600 underline hover:text-blue-800">
          {email}
        </a>
      );
    },
  },
  {
    accessorKey: 'role',
    header: 'Role',
    cell: ({ row }) => <Badge role={row.original.role}>{row.original.role}</Badge>,
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => <ActionsCell user={row.original} onChange={onChange} />,
  },
];
