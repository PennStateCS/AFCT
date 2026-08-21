'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type Announcements,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { showToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  Copy,
  GripVertical,
  MoreVertical,
  Pencil,
  Plus,
  Shuffle,
  Trash2,
  Users,
} from 'lucide-react';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { NameDialog } from './NameDialog';
import { DuplicateGroupSetDialog } from './DuplicateGroupSetDialog';
import { RandomAssignDialog } from './RandomAssignDialog';
import type { EligibleStudent, GroupSetDetail, MembershipOperation } from './group-set-types';
import { studentName } from './group-set-types';

// A droppable target (a group card or the unassigned panel). Highlights while a
// student is dragged over it. `id` is the group id, or the 'unassigned' sentinel.
const UNASSIGNED_ZONE = 'unassigned';

function DropZone({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`${className ?? ''} ${isOver ? 'ring-primary ring-2 ring-offset-1' : ''}`}
    >
      {children}
    </div>
  );
}

// One student row: the existing checkbox + name (the keyboard/AT path), plus a drag
// handle. Only the handle starts a drag, so the checkbox and label keep working
// normally. Inactive members and locked/archived sets can't be dragged.
function DraggableStudentRow({
  student,
  inactive = false,
  selected,
  onToggle,
  checkboxDisabled,
  dragDisabled,
}: {
  student: EligibleStudent;
  inactive?: boolean;
  selected: boolean;
  onToggle: () => void;
  checkboxDisabled: boolean;
  dragDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: student.id,
    disabled: dragDisabled,
  });
  return (
    <li ref={setNodeRef} className={isDragging ? 'opacity-40' : undefined}>
      <div className="hover:bg-muted flex items-center gap-2 rounded p-1 text-sm">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            aria-label={`Select ${studentName(student)}`}
            disabled={checkboxDisabled}
          />
          <span className="min-w-0 flex-1 truncate">{studentName(student)}</span>
        </label>
        {inactive && (
          <Badge variant="outline" className="text-status-warning shrink-0">
            Inactive
          </Badge>
        )}
        {!dragDisabled && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring shrink-0 cursor-grab touch-none rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none"
            aria-label={`Drag ${studentName(student)}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The selected group set: its header + actions, summary counts, a searchable
 * unassigned-students panel, and a responsive grid of group cards. Assigning,
 * moving, and removing work through a selection model (checkboxes + an action bar).
 * Drag and drop is layered on top as a convenience: every drag has an equivalent
 * checkbox/menu action, so keyboard and assistive-tech users are never dependent on
 * dragging (WCAG 2.1.1 and 2.5.7). The same applyOps mutation backs both paths.
 */
export function GroupSetView({
  courseId,
  setId,
  suggestedDuplicateName,
  onListChanged,
  onSelectSet,
  courseIsArchived,
}: {
  courseId: string;
  setId: string;
  suggestedDuplicateName: string;
  /** Refetch the set list (name/count/membership changed). */
  onListChanged: () => void;
  /** Switch the selected set ('' to let the parent pick the first remaining). */
  onSelectSet: (id: string) => void;
  courseIsArchived: boolean;
}) {
  const queryClient = useQueryClient();
  const detailKey = queryKeys.course.groupSet(courseId, setId);

  const detailQuery = useQuery({
    queryKey: detailKey,
    queryFn: () => fetchJson<GroupSetDetail>(apiPaths.courseGroupSet(courseId, setId)),
    staleTime: 15_000,
  });
  const detail = detailQuery.data;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // Dialog state
  const [renameSetOpen, setRenameSetOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [randomOpen, setRandomOpen] = useState(false);
  const [deleteSetOpen, setDeleteSetOpen] = useState(false);
  const [renameGroup, setRenameGroup] = useState<{ id: string; name: string } | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<{ id: string; name: string } | null>(null);
  /** Where focus goes after a delete: the card holding the trigger is gone by then. */
  const setHeadingRef = useRef<HTMLHeadingElement>(null);

  const disabled = courseIsArchived || !!detail?.locked;

  const assignedIds = useMemo(() => {
    const s = new Set<string>();
    if (detail) for (const g of detail.groups) for (const m of g.members) s.add(m.id);
    return s;
  }, [detail]);

  const unassigned = useMemo(() => {
    if (!detail) return [];
    const q = search.trim().toLowerCase();
    return detail.eligibleStudents
      .filter((s) => !assignedIds.has(s.id))
      .filter((s) =>
        !q ? true : `${s.firstName ?? ''} ${s.lastName ?? ''} ${s.email}`.toLowerCase().includes(q),
      );
  }, [detail, assignedIds, search]);

  const counts = useMemo(() => {
    if (!detail) return { groups: 0, eligible: 0, assigned: 0, unassigned: 0 };
    const eligibleIds = new Set(detail.eligibleStudents.map((s) => s.id));
    let assigned = 0;
    for (const id of assignedIds) if (eligibleIds.has(id)) assigned++;
    return {
      groups: detail.groups.length,
      eligible: eligibleIds.size,
      assigned,
      unassigned: eligibleIds.size - assigned,
    };
  }, [detail, assignedIds]);

  const clearSelection = () => setSelected(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Apply membership operations atomically, passing the loaded basis so a
  // concurrent edit is caught. Updates the cache with the server's fresh detail.
  const applyOps = useCallback(
    async (operations: MembershipOperation[], successMsg: string) => {
      if (!detail || operations.length === 0) return;
      setBusy(true);
      try {
        const updated = await apiClient.post<GroupSetDetail>(
          apiPaths.courseGroupSetMemberships(courseId, setId),
          { operations, expectedBasis: detail.basis },
        );
        queryClient.setQueryData(detailKey, updated);
        onListChanged();
        clearSelection();
        showToast.success(successMsg);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          showToast.error(
            'This group set changed on another screen. Refreshing to the latest groups.',
          );
          void queryClient.invalidateQueries({ queryKey: detailKey });
          clearSelection();
        } else {
          showToast.error(err instanceof ApiError ? err.message : 'Failed to update groups');
        }
      } finally {
        setBusy(false);
      }
    },
    [detail, courseId, setId, queryClient, detailKey, onListChanged],
  );

  // Which group each student is currently in (for skipping no-op moves).
  const memberGroupOf = useMemo(() => {
    const m = new Map<string, string>();
    if (detail) for (const g of detail.groups) for (const mem of g.members) m.set(mem.id, g.id);
    return m;
  }, [detail]);

  // Move an explicit set of students into a group. Only active students actually move,
  // and anyone already in the target group is skipped so a drop-in-place is a no-op.
  // The checkbox action bar and drag-and-drop both funnel through here.
  const moveIdsTo = useCallback(
    (ids: string[], groupId: string, groupName: string) => {
      if (!detail) return;
      const active = new Set(detail.eligibleStudents.map((s) => s.id));
      const movable = ids.filter((id) => active.has(id) && memberGroupOf.get(id) !== groupId);
      if (movable.length === 0) {
        showToast.warning('Select one or more active students first.');
        return;
      }
      const skipped = ids.length - movable.length;
      void applyOps(
        movable.map((userId) => ({ userId, groupId })),
        `Moved ${movable.length} to ${groupName}${skipped > 0 ? ` (${skipped} skipped)` : ''}`,
      );
    },
    [detail, memberGroupOf, applyOps],
  );

  // Remove an explicit set of students from whatever group they're in.
  const removeIds = useCallback(
    (ids: string[]) => {
      const toRemove = ids.filter((id) => assignedIds.has(id));
      if (toRemove.length === 0) {
        showToast.warning('None of the selected students are in a group.');
        return;
      }
      void applyOps(
        toRemove.map((userId) => ({ userId, groupId: null })),
        `Removed ${toRemove.length} from their group`,
      );
    },
    [assignedIds, applyOps],
  );

  const moveSelectedTo = (groupId: string, groupName: string) =>
    moveIdsTo(Array.from(selected), groupId, groupName);
  const removeSelected = () => removeIds(Array.from(selected));

  // Drag and drop (enhancement over the checkboxes). A 5px activation distance means a
  // plain click on the handle never starts a drag; the KeyboardSensor makes the handle
  // operable with space/enter + arrows for people who don't use a pointer.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // id -> display name, for the drag overlay and the screen-reader announcements.
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    if (detail) {
      for (const s of detail.eligibleStudents) m.set(s.id, studentName(s));
      for (const g of detail.groups) for (const mem of g.members) m.set(mem.id, studentName(mem));
    }
    return m;
  }, [detail]);

  const zoneName = useCallback(
    (id: string) =>
      id === UNASSIGNED_ZONE
        ? 'Unassigned'
        : (detail?.groups.find((g) => g.id === id)?.name ?? 'group'),
    [detail],
  );

  const [activeDrag, setActiveDrag] = useState<string | null>(null);

  // Dragging an already-selected student carries the whole selection; dragging an
  // unselected one carries just that student.
  const draggedIdsFor = useCallback(
    (activeId: string) => (selected.has(activeId) ? Array.from(selected) : [activeId]),
    [selected],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDrag(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      if (disabled) return;
      const over = event.over?.id;
      if (over == null) return;
      const ids = draggedIdsFor(String(event.active.id));
      if (String(over) === UNASSIGNED_ZONE) {
        removeIds(ids);
      } else {
        const g = detail?.groups.find((gr) => gr.id === String(over));
        if (g) moveIdsTo(ids, g.id, g.name);
      }
    },
    [disabled, draggedIdsFor, removeIds, moveIdsTo, detail],
  );

  const dragCount = activeDrag ? draggedIdsFor(activeDrag).length : 0;
  const dragLabel = activeDrag
    ? dragCount > 1
      ? `${dragCount} students`
      : (nameById.get(activeDrag) ?? 'Student')
    : '';

  /**
   * What is being dragged, in words.
   *
   * Dragging a selected student carries the whole selection, so naming only the one under the
   * pointer told a keyboard user "Picked up Ada Lovelace" and then moved five people. The
   * visible drag overlay already said "5 students"; the announcements did not.
   */
  const dragDescription = useCallback(
    (activeId: string) => {
      const count = draggedIdsFor(activeId).length;
      return count > 1 ? `${count} students` : (nameById.get(activeId) ?? 'student');
    },
    [draggedIdsFor, nameById],
  );

  const announcements: Announcements = useMemo(
    () => ({
      onDragStart: ({ active }) => `Picked up ${dragDescription(String(active.id))}.`,
      onDragOver: ({ active, over }) =>
        over
          ? `${dragDescription(String(active.id))} over ${zoneName(String(over.id))}.`
          : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? `Dropped ${dragDescription(String(active.id))} on ${zoneName(String(over.id))}.`
          : `Dropped ${dragDescription(String(active.id))}.`,
      onDragCancel: ({ active }) => `Dragging ${dragDescription(String(active.id))} cancelled.`,
    }),
    [dragDescription, zoneName],
  );

  const screenReaderInstructions: ScreenReaderInstructions = {
    draggable:
      'To move a student, press space or enter to pick them up, use the arrow keys to move ' +
      'over a group or the unassigned list, then press space or enter to drop. Press escape to ' +
      'cancel. You can also use the checkboxes and the Move to menu.',
  };

  const doRename = async (name: string) => {
    await apiClient.patch<{ id: string; name: string }>(apiPaths.courseGroupSet(courseId, setId), {
      name,
    });
    onListChanged();
    void queryClient.invalidateQueries({ queryKey: detailKey });
    showToast.success('Group set renamed');
  };

  const doCreateGroup = async (name: string) => {
    await apiClient.post(apiPaths.courseGroupSetGroups(courseId, setId), { name });
    void queryClient.invalidateQueries({ queryKey: detailKey });
    onListChanged();
    showToast.created('Group');
  };

  const doRenameGroup = async (name: string) => {
    if (!renameGroup) return;
    await apiClient.patch(apiPaths.courseGroupSetGroup(courseId, setId, renameGroup.id), { name });
    void queryClient.invalidateQueries({ queryKey: detailKey });
    showToast.success('Group renamed');
  };

  const confirmDeleteGroup = async () => {
    if (!deleteGroup) return;
    try {
      await apiClient.del(apiPaths.courseGroupSetGroup(courseId, setId, deleteGroup.id));
      void queryClient.invalidateQueries({ queryKey: detailKey });
      onListChanged();
      showToast.deleted('Group');
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to delete group');
    } finally {
      setDeleteGroup(null);
    }
  };

  const confirmDeleteSet = async () => {
    setBusy(true);
    try {
      await apiClient.del(apiPaths.courseGroupSet(courseId, setId));
      showToast.deleted('Group set');
      onListChanged();
      onSelectSet('');
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to delete group set');
    } finally {
      setBusy(false);
      setDeleteSetOpen(false);
    }
  };

  if (detailQuery.isPending) {
    return <LoadingSpinner label="Loading group set" fullScreen={false} className="min-h-40" />;
  }
  if (detailQuery.isError || !detail) {
    return (
      <div className="border-status-danger-border bg-status-danger-bg text-status-danger rounded-md border p-4 text-sm">
        Could not load this group set.{' '}
        <button
          type="button"
          className="underline"
          onClick={() => void queryClient.invalidateQueries({ queryKey: detailKey })}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + set actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          ref={setHeadingRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-xl font-semibold"
        >
          {detail.name}
          {detail.locked && <Badge variant="secondary">Locked</Badge>}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setCreateGroupOpen(true)} disabled={disabled}>
            <Plus className="h-4 w-4" /> Add group
          </Button>
          <Button
            variant="secondary"
            onClick={() => setRandomOpen(true)}
            disabled={disabled || detail.groups.length === 0}
            title={detail.groups.length === 0 ? 'Add a group first' : undefined}
          >
            <Shuffle className="h-4 w-4" /> Random assign
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" aria-label="Group set actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setRenameSetOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Rename set
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDuplicateOpen(true)}>
                <Copy className="mr-2 h-4 w-4" /> Duplicate set
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={disabled}
                onClick={() => setDeleteSetOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete set
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Locked notice */}
      {detail.locked && (
        <div
          role="status"
          className="border-status-warning-border bg-status-warning-bg text-status-warning rounded-md border p-3 text-sm"
        >
          This group set has associated submissions or grades. Its groups and memberships can no
          longer be changed because doing so could affect academic records. Duplicate the group set
          to create a new arrangement.
        </div>
      )}

      {/* Summary counts */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Groups', value: counts.groups },
          { label: 'Eligible students', value: counts.eligible },
          { label: 'Assigned', value: counts.assigned },
          { label: 'Unassigned', value: counts.unassigned },
        ].map((c) => (
          <div key={c.label} className="rounded-md border p-3">
            <dt className="text-muted-foreground text-xs">{c.label}</dt>
            <dd className="text-2xl font-semibold">{c.value}</dd>
          </div>
        ))}
      </dl>

      {/* Persistent live region so selection changes (including 0 -> 1) are announced. */}
      <span className="sr-only" role="status" aria-live="polite">
        {selected.size > 0 ? `${selected.size} selected` : ''}
      </span>

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div
          className="bg-muted flex flex-wrap items-center gap-2 rounded-md border p-2"
          role="region"
          aria-label="Selection actions"
        >
          <span className="text-sm font-medium">{selected.size} selected</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || busy || detail.groups.length === 0}
              >
                Move to <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Move selected to</DropdownMenuLabel>
              {detail.groups.map((g) => (
                <DropdownMenuItem key={g.id} onClick={() => moveSelectedTo(g.id, g.name)}>
                  {g.name}
                </DropdownMenuItem>
              ))}
              {detail.groups.length === 0 && (
                <DropdownMenuItem disabled>No groups yet</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="secondary"
            onClick={removeSelected}
            disabled={disabled || busy}
          >
            Remove from group
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      {!disabled && (
        <p className="text-muted-foreground text-xs">
          Tip: drag a student onto a group by its handle, or use the checkboxes and the Move to
          menu.
        </p>
      )}

      <DndContext
        sensors={sensors}
        accessibility={{ announcements, screenReaderInstructions }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Unassigned panel (also a drop target: dropping here removes from a group) */}
          <section className="lg:col-span-1" aria-label="Unassigned students">
            <DropZone id={UNASSIGNED_ZONE} className="rounded-md border">
              <div className="border-b p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4" /> Unassigned ({unassigned.length})
                </p>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search students"
                  aria-label="Search unassigned students"
                  className="mt-2"
                />
              </div>
              <ul className="max-h-96 space-y-1 overflow-y-auto p-2">
                {unassigned.length === 0 && (
                  <li className="text-muted-foreground p-2 text-sm">
                    {counts.eligible === 0
                      ? 'No active students are enrolled yet.'
                      : 'Every eligible student is assigned.'}
                  </li>
                )}
                {unassigned.map((s) => (
                  <DraggableStudentRow
                    key={s.id}
                    student={s}
                    selected={selected.has(s.id)}
                    onToggle={() => toggle(s.id)}
                    checkboxDisabled={disabled}
                    dragDisabled={disabled}
                  />
                ))}
              </ul>
            </DropZone>
          </section>

          {/* Group cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
            {detail.groups.length === 0 && (
              <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm sm:col-span-2">
                This set has no groups yet. Use &quot;Add group&quot; to create one.
              </div>
            )}
            {detail.groups.map((g) => (
              <DropZone key={g.id} id={g.id} className="flex flex-col rounded-md border">
                <div className="flex items-center justify-between gap-2 border-b p-3">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {g.name} <span className="text-muted-foreground">({g.members.length})</span>
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label={`Actions for ${g.name}`}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={disabled}
                        onClick={() => setRenameGroup({ id: g.id, name: g.name })}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Rename group
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={disabled}
                        onClick={() => setDeleteGroup({ id: g.id, name: g.name })}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete group
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <ul className="flex-1 space-y-1 p-2">
                  {g.members.length === 0 && (
                    <li className="text-muted-foreground p-2 text-xs italic">No students</li>
                  )}
                  {g.members.map((m) => (
                    <DraggableStudentRow
                      key={m.id}
                      student={m}
                      inactive={m.inactive}
                      selected={selected.has(m.id)}
                      onToggle={() => toggle(m.id)}
                      checkboxDisabled={disabled}
                      dragDisabled={disabled || m.inactive}
                    />
                  ))}
                </ul>
              </DropZone>
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeDrag ? (
            <div className="bg-card rounded-md border px-2 py-1 text-sm shadow-md">{dragLabel}</div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Dialogs */}
      <NameDialog
        open={renameSetOpen}
        setOpen={setRenameSetOpen}
        title="Rename group set"
        label="Name"
        initialValue={detail.name}
        submitLabel="Save"
        onSubmit={doRename}
      />
      <NameDialog
        open={createGroupOpen}
        setOpen={setCreateGroupOpen}
        title="Add group"
        label="Group name"
        initialValue=""
        submitLabel="Add group"
        onSubmit={doCreateGroup}
      />
      <NameDialog
        open={!!renameGroup}
        setOpen={(v) => !v && setRenameGroup(null)}
        title="Rename group"
        label="Group name"
        initialValue={renameGroup?.name ?? ''}
        submitLabel="Save"
        onSubmit={doRenameGroup}
      />
      <DuplicateGroupSetDialog
        open={duplicateOpen}
        setOpen={setDuplicateOpen}
        courseId={courseId}
        sourceSetId={setId}
        suggestedName={suggestedDuplicateName}
        onDuplicated={(newId) => {
          onListChanged();
          onSelectSet(newId);
        }}
      />
      <RandomAssignDialog
        open={randomOpen}
        setOpen={setRandomOpen}
        courseId={courseId}
        detail={detail}
        onApplied={(updated) => queryClient.setQueryData(detailKey, updated)}
      />
      <ConfirmDialog
        open={deleteSetOpen}
        variant="destructive"
        busy={busy}
        title="Delete group set?"
        description={`This permanently deletes "${detail.name}" and all of its groups and cannot be undone.`}
        confirmText="Delete group set"
        onConfirm={confirmDeleteSet}
        onCancel={() => setDeleteSetOpen(false)}
      />
      <ConfirmDialog
        open={!!deleteGroup}
        variant="destructive"
        busy={busy}
        title="Delete group?"
        description={`Delete group "${deleteGroup?.name ?? ''}"? Its members return to unassigned.`}
        confirmText="Delete group"
        onConfirm={confirmDeleteGroup}
        onCancel={() => setDeleteGroup(null)}
        onCloseAutoFocus={(event) => {
          // The menu that opened this sat inside the group card the delete has just removed,
          // so restoring focus to it would drop focus to the body.
          event.preventDefault();
          setHeadingRef.current?.focus();
        }}
      />
    </div>
  );
}
