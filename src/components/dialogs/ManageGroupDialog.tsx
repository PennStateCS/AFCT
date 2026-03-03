'use client';

import React, { useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/RoleBadge';
import { showToast } from '@/lib/toast';

type Member = {
  id: string;
  userId: string;
  addedAt: string;
  user: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    avatar?: string | null;
  };
};

export default function ManageGroupMembersDialog({ open, setOpen, courseId, group, onChanged, initialStudents }: { open: boolean; setOpen: (v: boolean) => void; courseId: string; group: { id: string; name: string } | null; onChanged?: () => void; initialStudents?: any[]; }) {
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [initialSelected, setInitialSelected] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const itemRefs = React.useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (open && group) fetchData();
    if (!open) {
      setStudents([]);
      setSelected({});
      setInitialSelected({});
      setFilter('');
      setSelectedIdx(-1);
      itemRefs.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group]);

  async function fetchData() {
    if (!group) return;
    setLoading(true);
    try {
      // If caller provided preloaded students, use them. Otherwise fetch students from the server.
      let studs: Member[] = [];

      if (initialStudents && initialStudents.length > 0) {
        studs = initialStudents.map((u: any) => ({
          id: u.id,
          userId: u.id,
          addedAt: '',
          user: { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, avatar: u.avatar },
        }));
      } else {
        const studentsRes = await fetch(`/api/courses/${courseId}/students`);
        if (!studentsRes.ok) throw new Error((await studentsRes.json())?.error || 'Failed to load students');
        const studentsBody = await studentsRes.json();
        studs = studentsBody.map((u: any) => ({
          id: u.id,
          userId: u.id,
          addedAt: '',
          user: { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, avatar: u.avatar },
        }));
      }

      const membersRes = await fetch(`/api/courses/${courseId}/groups/${group.id}/members`);
      if (!membersRes.ok) throw new Error((await membersRes.json())?.error || 'Failed to load members');
      const membersBody = await membersRes.json();

      setStudents(studs);

      const memberIds = new Set<string>((membersBody.members ?? []).map((m: any) => m.userId));
      const sel: Record<string, boolean> = {};
      studs.forEach((s) => { sel[s.userId] = memberIds.has(s.userId); });
      setSelected(sel);
      setInitialSelected({ ...sel });
    } catch (err) {
      console.error('Fetch group members error:', err);
      showToast.error('Failed to load members');
    } finally {
      setLoading(false);
    }
  }

  function toggle(userId: string) {
    setSelected((prev) => ({ ...prev, [userId]: !prev[userId] }));
  }

  const filteredStudents = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => ((s.user.firstName || '') + ' ' + (s.user.lastName || '') + ' ' + (s.user.email || '')).toLowerCase().includes(q));
  }, [students, filter]);

  React.useEffect(() => {
    if (filteredStudents.length === 0) setSelectedIdx(-1);
    else if (selectedIdx >= filteredStudents.length) setSelectedIdx(filteredStudents.length - 1);
  }, [filteredStudents, selectedIdx]);

  React.useEffect(() => {
    if (selectedIdx >= 0 && itemRefs.current[selectedIdx]) {
      itemRefs.current[selectedIdx]?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx, filteredStudents]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!filteredStudents.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((prev) => (prev < filteredStudents.length - 1 ? prev + 1 : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((prev) => (prev > 0 ? prev - 1 : filteredStudents.length - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (selectedIdx >= 0) toggle(filteredStudents[selectedIdx].userId);
    }
  }

  function isDirty(a: Record<string, boolean>, b: Record<string, boolean>) {
    const aKeys = Object.keys(a).filter((k) => !!a[k]).sort();
    const bKeys = Object.keys(b).filter((k) => !!b[k]).sort();
    if (aKeys.length !== bKeys.length) return true;
    for (let i = 0; i < aKeys.length; i++) if (aKeys[i] !== bKeys[i]) return true;
    return false;
  }

  async function handleSave() {
    if (!group) return;
    if (!isDirty(selected, initialSelected)) return setOpen(false);
    setLoading(true);
    try {
      const toAdd: string[] = [];
      const toRemove: string[] = [];
      for (const s of students) {
        const was = !!initialSelected[s.userId];
        const now = !!selected[s.userId];
        if (!was && now) toAdd.push(s.userId);
        if (was && !now) toRemove.push(s.userId);
      }

      // Run adds and removes in parallel
      const ops: Promise<any>[] = [];
      for (const uid of toAdd) {
        ops.push(fetch(`/api/courses/${courseId}/groups/${group.id}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: uid }) }));
      }
      for (const uid of toRemove) {
        ops.push(fetch(`/api/courses/${courseId}/groups/${group.id}/members/${uid}`, { method: 'DELETE' }));
      }

      const results = await Promise.all(ops);
      // Check for any non-ok
      for (const r of results) {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to update members');
        }
      }

      showToast.success('Members updated');
      setInitialSelected({ ...selected });
      onChanged?.();
      setOpen(false);
    } catch (err) {
      console.error('Save members error:', err);
      showToast.error('Failed to save members');
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setSelected({ ...initialSelected });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) handleCancel(); }}>
      <DialogContent className="bg-card max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Members</DialogTitle>
          <DialogDescription>Manage students assigned to group {group?.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="member-filter">Search students</Label>
            <Input id="member-filter" className="mt-2" placeholder="Type name or email" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus onKeyDown={handleKeyDown} />
          </div>

          <div className="h-80 overflow-auto rounded-md border">
            {loading ? <div className="text-sm text-muted-foreground p-3 text-center text-sm">Loading…</div> : (
              filteredStudents.length === 0 ? (
                <div className="text-muted-foreground p-3 text-center text-sm">No students.</div>
              ) : (
                <ul>
                  {filteredStudents.slice(0, 500).map((s, idx) => (
                    <li
                      key={s.userId}
                      ref={(el) => { itemRefs.current[idx] = el; }}
                    >
                      <label
                        htmlFor={`manage-checkbox-${s.userId}`}
                        className={`hover:bg-primary/10 flex cursor-pointer items-center gap-2 rounded px-3 py-2 w-full ${selectedIdx === idx ? 'bg-primary/10' : ''}`}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        tabIndex={0}
                      >
                        <input
                          id={`manage-checkbox-${s.userId}`}
                          type="checkbox"
                          className="mr-2"
                          checked={!!selected[s.userId]}
                          onChange={(e) => {
                            setSelected((prev) => {
                              const next = { ...prev };
                              if (e.target.checked) next[s.userId] = true; else delete next[s.userId];
                              return next;
                            });
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />

                        <span className="flex flex-1 flex-col">
                          <span className="text-sm">
                            {s.user.firstName} {s.user.lastName}
                          </span>
                          <span className="text-xs text-muted-foreground">{s.user.email}</span>
                        </span>

                        <Badge role="STUDENT">Student</Badge>
                      </label>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </div>

        <DialogFooter className="bg-card mt-4">
          <DialogClose asChild>
            <Button variant="secondary" type="button" onClick={handleCancel} disabled={loading}>Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleSave} disabled={loading || !isDirty(selected, initialSelected)}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
