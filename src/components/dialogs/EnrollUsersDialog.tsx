'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/RoleBadge';
import { User } from '@prisma/client';

// Subset of User fields needed for enrollment
type EnrollableUser = Pick<User, 'id' | 'firstName' | 'lastName' | 'email' | 'role'>;

const roleDisplayNames: Record<string, string> = {
  ADMIN: 'Admin',
  FACULTY: 'Faculty',
  TA: 'TA',
  STUDENT: 'Student',
};

type EnrollUserDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseIsArchived: boolean;
  users: EnrollableUser[]; // NOT already in the course
  onEnroll: (user: EnrollableUser) => void;
};

export function EnrollUserDialog({
  open,
  setOpen,
  courseIsArchived,
  users,
  onEnroll,
}: EnrollUserDialogProps) {
  const [search, setSearch] = React.useState('');
  const [selectedIdx, setSelectedIdx] = React.useState<number>(-1);

  const filteredUsers = React.useMemo(() => {
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        (u.firstName && u.firstName.toLowerCase().includes(q)) ||
        (u.lastName && u.lastName.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q),
    );
  }, [users, search]);

  // --- Refs for scrollIntoView ---
  const itemRefs = React.useRef<(HTMLLIElement | null)[]>([]);

  // Keep selectedIdx in range
  React.useEffect(() => {
    if (filteredUsers.length === 0) {
      setSelectedIdx(-1);
    } else if (selectedIdx >= filteredUsers.length) {
      setSelectedIdx(filteredUsers.length - 1);
    }
  }, [filteredUsers, selectedIdx]);

  // Scroll into view when selectedIdx changes
  React.useEffect(() => {
    if (selectedIdx >= 0 && itemRefs.current[selectedIdx]) {
      itemRefs.current[selectedIdx]?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx, filteredUsers]);

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedIdx(-1);
    }
  }, [open]);

  // Keyboard handler
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!filteredUsers.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => (prev < filteredUsers.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : filteredUsers.length - 1));
    } else if (e.key === 'Enter') {
      if (selectedIdx >= 0 && filteredUsers[selectedIdx] && !courseIsArchived) {
        handleEnroll(filteredUsers[selectedIdx]);
      }
    }
  };

  // Enroll the user
  const handleEnroll = (user?: EnrollableUser) => {
    const userToEnroll = user ?? (selectedIdx >= 0 ? filteredUsers[selectedIdx] : undefined);
    if (userToEnroll && !courseIsArchived) {
      onEnroll(userToEnroll);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card max-w-lg">
        <DialogHeader>
          <DialogTitle>Enroll User</DialogTitle>
          <DialogDescription>Find and select a user to enroll in this course.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="user-search">Search users</Label>
            <Input
              id="user-search"
              className="mt-2"
              placeholder="Type name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="h-80 overflow-auto rounded-md border">
            {filteredUsers.length === 0 ? (
              <div className="text-muted-foreground p-3 text-center text-sm">No users found.</div>
            ) : (
              <ul>
                {filteredUsers.slice(0, 50).map((user, idx) => (
                  <li
                    key={user.id}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    className={`hover:bg-primary/10 flex cursor-pointer items-center gap-2 rounded px-3 py-2 ${
                      selectedIdx === idx ? 'bg-primary/10' : ''
                    }`}
                    onClick={() => handleEnroll(user)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="flex flex-1 flex-col">
                      <span className="text-s">
                        {user.firstName} {user.lastName}
                      </span>
                      <span className="text-muted-foreground text-xs">{user.email}</span>
                    </span>
                    <Badge role={user.role}>{roleDisplayNames[user.role] || user.role}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => handleEnroll()} disabled={selectedIdx < 0 || courseIsArchived}>
            Enroll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
