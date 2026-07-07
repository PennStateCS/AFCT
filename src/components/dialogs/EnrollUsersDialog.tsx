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
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import { User } from '@prisma/client';

// Subset of User fields needed for enrollment
type EnrollableUser = Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;

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
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

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

  // Enroll the user(s)
  const handleEnroll = (user?: EnrollableUser) => {
    // If a user is passed (single click), enroll just that user
    if (user && !courseIsArchived) {
      onEnroll(user);
      setOpen(false);
      return;
    }
    // Otherwise, enroll all selected users
    if (selectedIds.size > 0 && !courseIsArchived) {
      filteredUsers.forEach((u) => {
        if (selectedIds.has(u.id)) onEnroll(u);
      });
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="bg-card max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Enroll User</DialogTitle>
          <DialogDescription>Find and select a user to enroll in this course.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <InputGroup
            label="Search users"
            name="user-search"
            placeholder="Type name or email"
            value={search}
            setValue={setSearch}
            autoFocus
            onKeyDown={handleKeyDown}
          />
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
                  >
                    <label
                      htmlFor={`enroll-checkbox-${user.id}`}
                      className={`hover:bg-primary/10 flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 ${
                        selectedIdx === idx ? 'bg-primary/10' : ''
                      }`}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      tabIndex={0}
                    >
                      <input
                        id={`enroll-checkbox-${user.id}`}
                        type="checkbox"
                        className="mr-2"
                        checked={selectedIds.has(user.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(user.id);
                            else next.delete(user.id);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="flex flex-1 flex-col">
                        <span className="text-s">
                          {user.firstName} {user.lastName}
                        </span>
                        <span className="text-muted-foreground text-xs">{user.email}</span>
                      </span>
                    </label>
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
          <Button
            type="button"
            onClick={() => handleEnroll()}
            disabled={selectedIds.size === 0 || courseIsArchived}
          >
            Enroll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
