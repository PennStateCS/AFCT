'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { getInitials } from '@/app/utils/initials';
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
import { showToast } from '@/lib/toast';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Trash2 } from 'lucide-react';
import { courseRoleOptions, formatCourseRole } from '@/lib/roles';
import SelectField from '@/components/ui/SelectField';
import { apiPaths } from '@/lib/api-paths';
import { CourseRoleChangeSchema } from '@/schemas/user';

type CourseRosterEntry = {
  role?: string | null;
  hasSubmissions?: boolean;
  user: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    avatar?: string | null;
    cropX?: number | null;
    cropY?: number | null;
    zoom?: number | null;
    role?: string | null;
  };
};

// Shape of GET /api/courses/{courseId}/roster/{userId}.
type RosterReadResponse = {
  roster: CourseRosterEntry | null;
  viewerCourseRole?: string | null;
  viewerDefaultRole?: string | null;
};

type Props = {
  open: boolean;
  setOpen: (v: boolean) => void;
  courseId: string;
  userId: string;
  onSaved?: () => void;
  initialRoster?: CourseRosterEntry | null;
  initialViewerCourseRole?: string | null;
  initialViewerDefaultRole?: string | null;
};

export function EditRoleDialog({
  open,
  setOpen,
  courseId,
  userId,
  onSaved,
  initialRoster = null,
  initialViewerCourseRole = null,
  initialViewerDefaultRole = null,
}: Props) {
  const queryClient = useQueryClient();
  const [roster, setRoster] = useState<CourseRosterEntry | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [viewerCourseRole, setViewerCourseRole] = useState<string | null>(null);
  const [viewerDefaultRole, setViewerDefaultRole] = useState<string | null>(null);

  // Keep an immutable copy of the originally loaded roster entry so we can compute isDirty
  const originalRosterRef = useRef<CourseRosterEntry | null>(null);

  const isDirty = useMemo(() => {
    if (!roster || !originalRosterRef.current) return false;
    const orig = originalRosterRef.current;
    // Role changed?
    if ((roster.role ?? null) !== (orig.role ?? null)) return true;
    // Avatar presence changed?
    const origAvatar = orig.user?.avatar ?? null;
    const newAvatar = roster.user?.avatar ?? null;
    if (origAvatar !== newAvatar) return true;
    return false;
  }, [roster]);

  // Cache the roster read. The fetch only runs when the dialog is open and the
  // caller didn't hand us the entry via initialRoster (the fast-path prop).
  // Reopening the same user is served warm from the cache within staleTime.
  const rosterQuery = useQuery<RosterReadResponse>({
    queryKey: queryKeys.course.rosterEntry(courseId, userId),
    queryFn: () => fetchJson<RosterReadResponse>(apiPaths.courseRosterEntry(courseId, userId)),
    enabled: open && !initialRoster,
    staleTime: 30_000,
  });

  // Re-pull the edited roster entry and the course roster list (a role change or
  // removal is reflected there too).
  const invalidateRoster = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.course.rosterEntry(courseId, userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.course.roster(courseId) });
  };

  // Blocking spinner: only while we're actually waiting on the network for a
  // dialog with no fast-path data (mirrors the old `loading` flag).
  const loading = open && !initialRoster && rosterQuery.isPending;

  // Cache the read, seed the local editable state. Either the fast-path prop or
  // the query result feeds the same local states the dialog edits.
  useEffect(() => {
    if (!open) return;

    // Fast-path: caller provided roster and viewer info directly.
    if (initialRoster) {
      setRoster(initialRoster);
      setViewerCourseRole(initialViewerCourseRole ?? null);
      setViewerDefaultRole(initialViewerDefaultRole ?? null);
      setAvatarPreview(
        initialRoster.user.avatar ? apiPaths.files.pfp(initialRoster.user.avatar) : '',
      );
      originalRosterRef.current = JSON.parse(JSON.stringify(initialRoster));
      return;
    }

    const body = rosterQuery.data;
    if (!body) return;
    setRoster(body.roster ?? null);
    setViewerCourseRole(body.viewerCourseRole ?? null);
    setViewerDefaultRole(body.viewerDefaultRole ?? null);
    setAvatarPreview(body.roster?.user.avatar ? apiPaths.files.pfp(body.roster.user.avatar) : '');
    originalRosterRef.current = JSON.parse(JSON.stringify(body.roster ?? null));
  }, [open, initialRoster, initialViewerCourseRole, initialViewerDefaultRole, rosterQuery.data]);

  // On a failed roster read, surface the error and close (old fetch behavior).
  useEffect(() => {
    if (open && !initialRoster && rosterQuery.isError) {
      console.error('Error loading roster entry', rosterQuery.error);
      showToast.error('Failed to load roster entry');
      setOpen(false);
    }
  }, [open, initialRoster, rosterQuery.isError, rosterQuery.error, setOpen]);

  const { mutate: saveRoster, isPending: isSaving } = useMutation({
    mutationFn: (role: string | null | undefined) =>
      fetchJson(apiPaths.courseRosterEntry(courseId, userId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      // Reflect the saved state so isDirty resets to false.
      originalRosterRef.current = roster ? JSON.parse(JSON.stringify(roster)) : null;
      invalidateRoster();
      showToast.success('Roster updated');
      onSaved?.();
      setOpen(false);
    },
    onError: (err) => {
      console.error('Error saving roster entry', err);
      showToast.error(err instanceof Error ? err.message : 'Failed to save roster entry');
    },
  });

  const handleSave = () => {
    if (!roster) return;
    // Validate the selected role against the shared enum (the same one the route
    // enforces) before sending the PATCH.
    const parsed = CourseRoleChangeSchema.safeParse({ role: roster.role });
    if (!parsed.success) {
      showToast.error('Please choose a valid course role.');
      return;
    }
    saveRoster(parsed.data.role);
  };


  const { mutate: deleteAvatar } = useMutation({
    mutationFn: (targetUserId: string) => {
      const form = new FormData();
      form.append('deleteAvatar', 'true');
      return fetchJson(apiPaths.user(targetUserId), { method: 'PATCH', body: form });
    },
    onSuccess: () => {
      setRoster((r) => (r ? { ...r, user: { ...r.user, avatar: null } } : r));
      void queryClient.invalidateQueries({ queryKey: queryKeys.course.rosterEntry(courseId, userId) });
      showToast.success('Profile photo removed');
      onSaved?.();
    },
    onError: (err) => {
      console.error('Failed to delete avatar', err);
      showToast.error(err instanceof Error ? err.message : 'Failed to delete avatar');
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // If dialog is being closed, reset any in-dialog changes back to the original loaded roster
        if (!v && originalRosterRef.current) {
          const orig = JSON.parse(JSON.stringify(originalRosterRef.current));
          setRoster(orig);
          setAvatarPreview(orig.user.avatar ? apiPaths.files.pfp(orig.user.avatar) : '');
        }
      }}
    >
      <DialogContent
        className="bg-card max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>Modify course-specific settings for this user.</DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {loading ? (
            <p>Loading…</p>
          ) : roster ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage
                    src={avatarPreview || undefined}
                    alt="User Avatar"
                    cropX={roster.user.cropX ?? 0.5}
                    cropY={roster.user.cropY ?? 0.5}
                    zoom={roster.user.zoom ?? 1}
                  />
                  <AvatarFallback className="bg-secondary text-secondary-foreground">
                    {getInitials(
                      roster.user.firstName,
                      roster.user.lastName,
                      roster.user.email ?? undefined,
                    )}
                  </AvatarFallback>
                </Avatar>

                <div>
                  <div className="text-muted-foreground text-sm">Name</div>
                  <div className="font-medium">
                    {roster.user.firstName} {roster.user.lastName}
                  </div>
                  <div className="text-muted-foreground text-xs">{roster.user.email}</div>
                </div>

                {/* Delete avatar button: visible to course FACULTY, ADMIN, or site ADMIN */}
                <div className="ml-auto">
                  {(viewerCourseRole === 'FACULTY' ||
                    viewerCourseRole === 'ADMIN' ||
                    viewerDefaultRole === 'ADMIN') && (
                    <Button
                      variant="outline"
                      className="flex items-center gap-2 border-red-600 text-red-600 hover:bg-red-50"
                      onClick={() => {
                        if (!confirm("Delete this user's profile photo?")) return;
                        deleteAvatar(roster.user.id);
                      }}
                      disabled={!roster.user?.avatar}
                      title={!roster.user?.avatar ? 'No profile photo to delete' : undefined}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Photo
                    </Button>
                  )}
                </div>
              </div>

              <SelectField
                label="Course Role"
                name="courseRole"
                value={roster.role ?? undefined}
                onValueChange={(v) => setRoster({ ...roster, role: v })}
                placeholder="Select role"
                options={courseRoleOptions.map((r) => ({
                  value: r,
                  label: formatCourseRole(r),
                }))}
              />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Roster entry not found.</p>
          )}
        </div>

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={handleSave}
            disabled={!isDirty || isSaving || loading}
            title={!isDirty ? 'No changes to save' : undefined}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
