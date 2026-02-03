'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showToast } from '@/lib/toast';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Trash2, Delete } from 'lucide-react';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { courseRoleOptions, formatCourseRole } from '@/lib/roles';

type Props = {
  open: boolean;
  setOpen: (v: boolean) => void;
  courseId: string;
  userId: string;
  onSaved?: () => void;
  // Optional fast-path: preloaded roster (from table row) to avoid fetching on open
  initialRoster?: any | null;
  initialViewerCourseRole?: string | null;
  initialViewerDefaultRole?: string | null;
};

export default function CourseEditUserDialog({
  open,
  setOpen,
  courseId,
  userId,
  onSaved,
  initialRoster = null,
  initialViewerCourseRole = null,
  initialViewerDefaultRole = null,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roster, setRoster] = useState<any | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [viewerCourseRole, setViewerCourseRole] = useState<string | null>(null);
  const [viewerDefaultRole, setViewerDefaultRole] = useState<string | null>(null);

  // Keep an immutable copy of the originally loaded roster entry so we can compute isDirty
  const originalRosterRef = useRef<any | null>(null);

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

  useEffect(() => {
    if (!open) return;

    // Fast-path: if caller provided roster and viewer info, use it immediately to avoid a network fetch
    if (initialRoster) {
      setLoading(false);
      setRoster(initialRoster);
      setViewerCourseRole(initialViewerCourseRole ?? null);
      setViewerDefaultRole(initialViewerDefaultRole ?? null);
      setAvatarPreview(
        initialRoster?.user?.avatar
          ? `/api/files/avatar?file=${initialRoster.user.avatar}`
          : '/api/files/avatar?file=default-avatar.png',
      );
      originalRosterRef.current = JSON.parse(JSON.stringify(initialRoster));
      return;
    }

    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/roster/${userId}`);
        if (!mounted) return;
        if (!res.ok) {
          showToast.error('Failed to load roster entry');
          setOpen(false);
          return;
        }
        const body = await res.json();
        setRoster(body?.roster ?? null);
        setViewerCourseRole(body?.viewerCourseRole ?? null);
        setViewerDefaultRole(body?.viewerDefaultRole ?? null);
        // Initialize avatar preview from fetched user profile (if available)
        setAvatarPreview(
          body?.roster?.user?.avatar
            ? `/api/files/avatar?file=${body.roster.user.avatar}`
            : '/api/files/avatar?file=default-avatar.png',
        );
        // Save a copy of the original roster entry for dirty checks
        originalRosterRef.current = JSON.parse(JSON.stringify(body?.roster ?? null));
      } catch (err) {
        console.error('Error loading roster entry', err);
        showToast.error('Failed to load roster entry');
        setOpen(false);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [
    open,
    courseId,
    userId,
    setOpen,
    initialRoster,
    initialViewerCourseRole,
    initialViewerDefaultRole,
  ]);

  const handleSave = async () => {
    if (!roster) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/roster/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roster.role }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast.error(body?.error || 'Failed to save roster entry');
        return;
      }
      // Update original copy so the dialog reflects the saved state
      originalRosterRef.current = JSON.parse(JSON.stringify(roster));
      showToast.success('Roster updated');
      onSaved?.();
      setOpen(false);
    } catch (err) {
      console.error('Error saving roster entry', err);
      showToast.error('Failed to save roster entry');
    } finally {
      setSaving(false);
    }
  };

  const [confirmOpen, setConfirmOpen] = useState(false);

  // Execute removal (called from ConfirmDialog onConfirm)
  const handleRemove = async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}/roster/${userId}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) {
        showToast.error(body?.error || 'Failed to remove user');
        return;
      }
      showToast.success('User removed from course');
      onSaved?.();
      setOpen(false);
    } catch (err) {
      console.error('Error removing user', err);
      showToast.error('Failed to remove user');
    } finally {
      setConfirmOpen(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // If dialog is being closed, reset any in-dialog changes back to the original loaded roster
        if (!v && originalRosterRef.current) {
          const orig = JSON.parse(JSON.stringify(originalRosterRef.current));
          setRoster(orig);
          setAvatarPreview(
            orig?.user?.avatar
              ? `/api/files/avatar?file=${orig.user.avatar}`
              : '/uapi/files/avatar?file=default-avatar.png',
          );
          setConfirmOpen(false);
        }
      }}
    >
      <DialogContent
        className="bg-card max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
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
                    src={avatarPreview ?? '/api/files/avatar?file=default-avatar.png'}
                    alt="User Avatar"
                  />
                  <AvatarFallback className="bg-secondary text-secondary-foreground">
                    {(roster.user?.firstName || '?').charAt(0)}
                    {(roster.user?.lastName || '?').charAt(0)}
                  </AvatarFallback>
                </Avatar>

                <div>
                  <div className="text-muted-foreground text-sm">Name</div>
                  <div className="font-medium">
                    {roster.user.firstName} {roster.user.lastName}
                  </div>
                  <div className="text-muted-foreground text-xs">{roster.user.email}</div>
                </div>

                {/* Delete avatar button: visible to course FACULTY, INSTRUCTOR, or site ADMIN */}
                <div className="ml-auto">
                  {(viewerCourseRole === 'FACULTY' ||
                    viewerCourseRole === 'INSTRUCTOR' ||
                    viewerDefaultRole === 'ADMIN') && (
                    <Button
                      variant="outline"
                      className="flex items-center gap-2 border-red-600 text-red-600 hover:bg-red-50"
                      onClick={async () => {
                        if (!confirm("Delete this user's profile photo?")) return;
                        try {
                          const form = new FormData();
                          form.append('deleteAvatar', 'true');
                          const res = await fetch(`/api/users/${roster.user.id}`, {
                            method: 'PATCH',
                            body: form,
                          });
                          const body = await res.json();
                          if (!res.ok) {
                            showToast.error(body?.error || 'Failed to delete avatar');
                            return;
                          }
                          setAvatarPreview('/api/files/avatar?file=default-avatar.png');
                          // update roster object to remove avatar client-side
                          setRoster({ ...roster, user: { ...roster.user, avatar: null } });
                          showToast.success('Profile photo removed');
                          onSaved?.();
                        } catch (err) {
                          console.error('Failed to delete avatar', err);
                          showToast.error('Failed to delete avatar');
                        }
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

              <div>
                <label className="mb-2 block text-sm font-medium">Course Role</label>
                <Select
                  value={roster.role}
                  onValueChange={(v) => setRoster({ ...roster, role: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {courseRoleOptions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {formatCourseRole(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-2">
                <div className="mt-2 flex gap-2">
                  {/* Determine whether the viewer is allowed to remove this user (mirrors server-side rules) */}
                  {(() => {
                    const isSiteAdmin = viewerDefaultRole === 'ADMIN';
                    const viewerCourse = viewerCourseRole ?? null;
                    const targetRole = roster.role ?? null;
                    let viewerCanDelete = false;
                    if (isSiteAdmin) viewerCanDelete = true;
                    else if (viewerCourse === 'INSTRUCTOR')
                      viewerCanDelete = targetRole !== 'INSTRUCTOR';
                    else if (viewerCourse === 'FACULTY')
                      viewerCanDelete = targetRole !== 'INSTRUCTOR' && targetRole !== 'FACULTY';
                    const removeDisabled = !viewerCanDelete;
                    const removeTitle = removeDisabled
                      ? 'You do not have permission to remove this user'
                      : undefined;

                    return (
                      <>
                        <Button
                          variant="outline"
                          className="flex items-center gap-2 border-red-600 text-red-600 hover:bg-red-50"
                          onClick={() => setConfirmOpen(true)}
                          disabled={removeDisabled}
                          title={removeTitle}
                        >
                          <Delete className="h-4 w-4" />
                          Remove from Course
                        </Button>

                        <ConfirmDialog
                          open={confirmOpen}
                          onCancel={() => setConfirmOpen(false)}
                          onConfirm={handleRemove}
                          title={`Remove ${roster.user.firstName} ${roster.user.lastName}?`}
                          description={`This will remove the user from the roster for this course. This action cannot be undone.`}
                          confirmText="Remove"
                          cancelText="Cancel"
                        />
                      </>
                    );
                  })()}
                </div>
              </div>
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
            disabled={!isDirty || saving || loading}
            title={!isDirty ? 'No changes to save' : undefined}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
