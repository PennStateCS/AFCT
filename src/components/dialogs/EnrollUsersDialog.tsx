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
import type { User } from '@prisma/client';

// Subset of User fields needed for enrollment
type EnrollableUser = Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;

type EnrollUserDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseIsArchived: boolean;
  /** One page of accounts that are NOT already in the course, matching the search. */
  users: EnrollableUser[];
  /** How many accounts match in total, which may exceed the page above. */
  total?: number;
  /** Debounced search term, for the caller to fetch against. */
  onSearchChange?: (q: string) => void;
  onEnroll: (user: EnrollableUser) => void;
};

export function EnrollUserDialog({
  open,
  setOpen,
  courseIsArchived,
  users,
  total,
  onSearchChange,
  onEnroll,
}: EnrollUserDialogProps) {
  const [search, setSearch] = React.useState('');
  const [selectedIdx, setSelectedIdx] = React.useState<number>(-1);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  /*
   * The server decides who matches. It also decides who is eligible at all, which is why
   * there is no client-side filter here any more: this list used to be every account in
   * the installation minus the course's roster, narrowed in the browser, and neither of
   * those lists is small enough to hold once a course has a thousand students.
   */
  const filteredUsers = users;

  // Debounce typing so a keystroke is not a request.
  React.useEffect(() => {
    if (!onSearchChange) return;
    const t = setTimeout(() => onSearchChange(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search, onSearchChange]);

  // Only the first page is rendered, so keyboard navigation must wrap at that bound
  // rather than at a length that could point past the rows on screen.
  const visibleCount = Math.min(filteredUsers.length, 50);
  const hiddenMatches = Math.max(0, (total ?? filteredUsers.length) - visibleCount);

  // --- Refs for scrollIntoView + roving focus ---
  const itemRefs = React.useRef<(HTMLLIElement | null)[]>([]);
  const checkboxRefs = React.useRef<(HTMLInputElement | null)[]>([]);

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

  // Roving focus: arrow keys move real DOM focus onto the row's checkbox rather than
  // just repainting a highlight. That way a screen reader announces the person and their
  // checked state, instead of the user having no idea what Enter would act on.
  const moveActive = (next: number) => {
    setSelectedIdx(next);
    checkboxRefs.current[next]?.focus();
    itemRefs.current[next]?.scrollIntoView({ block: 'nearest' });
  };

  // Shared list navigation, used from the search box and from a focused row.
  const handleListNav = (e: React.KeyboardEvent): boolean => {
    if (!visibleCount) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(selectedIdx < visibleCount - 1 ? selectedIdx + 1 : 0);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(selectedIdx > 0 ? selectedIdx - 1 : visibleCount - 1);
      return true;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      moveActive(0);
      return true;
    }
    if (e.key === 'End') {
      e.preventDefault();
      moveActive(visibleCount - 1);
      return true;
    }
    return false;
  };

  /** Add/remove one user from the pending selection. */
  const toggleSelection = (userId: string) => {
    if (courseIsArchived) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (handleListNav(e)) return;
    // Enter ticks the highlighted row rather than enrolling it outright. The dialog
    // presents a multi-select with an Enroll button, so having Enter silently enroll one
    // person and close contradicted what the UI showed -- and made a stray highlight
    // (hover moves it) act on the wrong user.
    if (e.key === 'Enter') {
      const user = selectedIdx >= 0 ? filteredUsers[selectedIdx] : undefined;
      if (user) {
        e.preventDefault();
        toggleSelection(user.id);
      }
    }
  };

  // Enroll everyone currently ticked. Confirming is always an explicit press of the
  // Enroll button; no keyboard path enrolls implicitly.
  const handleEnroll = () => {
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
        className="max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
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
            onKeyDown={handleSearchKeyDown}
          />
          {/*
            One live region for the whole list, so a screen reader hears the result of a
            search that now resolves on the server a moment after typing stops. It also
            says when the list is truncated rather than cutting off in silence, without
            which a name that is genuinely enrollable can look absent.
          */}
          <p className="text-muted-foreground min-h-5 text-sm" role="status">
            {filteredUsers.length === 0
              ? 'No users found.'
              : hiddenMatches > 0
                ? `Showing the first ${visibleCount} of ${total} matches. Keep typing to narrow the search.`
                : ''}
          </p>
          <div className="h-80 overflow-auto rounded-md border">
            {filteredUsers.length === 0 ? (
              // Announced by the live region above; hidden here so it is not read twice.
              <div aria-hidden="true" className="text-muted-foreground p-3 text-center text-sm">
                No users found.
              </div>
            ) : (
              <ul>
                {filteredUsers.slice(0, 50).map((user, idx) => (
                  <li
                    key={user.id}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                  >
                    {/* No tabIndex on the label: it is not interactive on its own and
                        only added an inert tab stop ahead of the real checkbox. */}
                    <label
                      htmlFor={`enroll-checkbox-${user.id}`}
                      className={`hover:bg-primary/10 flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 ${
                        selectedIdx === idx ? 'bg-primary/10' : ''
                      }`}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      <input
                        id={`enroll-checkbox-${user.id}`}
                        ref={(el) => {
                          checkboxRefs.current[idx] = el;
                        }}
                        type="checkbox"
                        className="mr-2"
                        // Roving tabindex: the list is a single tab stop and the arrow
                        // keys move within it. Before any navigation the first row is the
                        // entry point.
                        tabIndex={idx === (selectedIdx >= 0 ? selectedIdx : 0) ? 0 : -1}
                        checked={selectedIds.has(user.id)}
                        onFocus={() => setSelectedIdx(idx)}
                        onKeyDown={(e) => {
                          if (handleListNav(e)) return;
                          // Space already toggles a native checkbox; make Enter agree
                          // instead of enrolling and closing behind the user's back.
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            toggleSelection(user.id);
                          }
                        }}
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
