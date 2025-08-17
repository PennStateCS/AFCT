'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Delete, Pencil, ChevronDown, BookOpen } from 'lucide-react';
import { User } from '@prisma/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EditUserDialog } from '@/components/dialogs/EditUserDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/RoleBadge';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

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

  const handleSave = async (updatedUser: Partial<User>) => {
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            <ChevronDown />
            Manage
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            {user.firstName} {user.lastName}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setOpen(true)}
            className="hover:bg-secondary focus:bg-secondary focus:text-secondary-foreground flex items-center gap-2"
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit User
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleDelete}
            className="hover:bg-secondary focus:bg-secondary focus:text-secondary-foreground flex items-center gap-2 text-red-600"
          >
            <Delete className="mr-2 h-4 w-4" />
            Drop User
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
      const avatarUrl = user.avatar ? `/uploads/${user.avatar}` : undefined;
      
      return (
        <Avatar className="h-10 w-10">
          <AvatarImage
            src={avatarUrl}
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
    cell: ({ row }) => <Badge role={row.original.role} className="w-20" />,
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => <ActionsCell user={row.original} onChange={onChange} />,
  },
];
