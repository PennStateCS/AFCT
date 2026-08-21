'use client';

import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { MessageSquare, Send, X } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ConfirmDialog } from './dialogs/ConfirmDialog';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { apiPaths } from '@/lib/api-paths';

export type Comment = {
  id: string;
  content: string;
  createdAt: string;
  /** The student this was addressed to, when it was meant for one person. */
  aboutStudentId?: string | null;
  /** The group this was addressed to, when every member can see it. */
  aboutGroupId?: string | null;
  author: {
    id?: string;
    firstName: string | null;
    lastName: string | null;
    role?: string | null;
    avatar?: string | null;
    avatarUrl?: string | null;
    cropX?: number | null;
    cropY?: number | null;
    zoom?: number | null;
  };
};

/** Who a new comment will reach. Group assignments only; otherwise there is no choice. */
export type CommentAudience = {
  /** The group the selected student submits with, when they have one. */
  group: { id: string; name: string } | null;
  /** The student being reviewed, for the "only this person" option's label. */
  studentName: string;
  target: 'student' | 'group';
  onTargetChange: (target: 'student' | 'group') => void;
};

type Props = {
  courseIsArchived: boolean;
  /** Omit on individual assignments: there is nothing to choose between. */
  audience?: CommentAudience | null;
  /** The student being reviewed, used to label who a private comment was for. */
  subjectName?: string;
  comments: Comment[];
  commentText: string;
  onCommentTextChange: (text: string) => void;
  onSaveComment: () => void;
  onDeleteComment: (commentId: string) => void;
  isSaving?: boolean;
  deletingComments?: Record<string, boolean>;
  title?: string;
  placeholder?: string;
  className?: string;
  frameless?: boolean;
};

// helpers
const initials = (first?: string | null, last?: string | null) => {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  const fi = f ? (f[0]?.toUpperCase() ?? '') : '';
  const li = l ? (l[0]?.toUpperCase() ?? '') : '';
  return fi + li || 'U';
};

//const authorAvatarSrc = (author: Comment["author"]) => {
//  const raw = author?.avatar ?? author?.avatarUrl ?? null;
//  if (!raw) return undefined;
//  if (/^https?:\/\//i.test(raw)) return raw;
//  if (raw.startsWith("/")) return raw;
//  return `/uploads/${raw}`;
//};

const authorAvatarSrc = (author: Comment['author']) => {
  const raw = author?.avatar ?? author?.avatarUrl ?? null;
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return raw;
  return apiPaths.files.pfp(raw);
};

export default function DiscussionPanel({
  courseIsArchived,
  audience = null,
  subjectName,
  comments,
  commentText,
  onCommentTextChange,
  onSaveComment,
  onDeleteComment,
  isSaving = false,
  deletingComments = {},
  title = 'Discussion',
  placeholder = 'Add a comment...',
  className = '',
  frameless = false,
}: Props) {
  /** Where focus lands after a comment is deleted: the row that held the button is gone. */
  const sectionRef = useRef<HTMLElement>(null);

  /**
   * The visibility badge for one comment. Only meaningful on a group assignment: on an
   * individual one every comment is between staff and that student, so a badge on each
   * would be noise repeating the same fact.
   */
  const audienceLabel = (comment: Comment): string | null => {
    if (!audience?.group) return null;
    if (comment.aboutGroupId) return `Visible to ${audience.group.name}`;
    if (comment.aboutStudentId) return `Only ${subjectName ?? audience.studentName}`;
    return null;
  };

  const { data: session } = useSession();
  const myId = session?.user?.id ?? null;
  const { timezone } = useEffectiveTimezone();

  const formatDateTime = (iso: string | Date) => formatDateTimeInTimeZone(iso, timezone);

  const [commentToDelete, setCommentToDelete] = useState<string | null>(null);
  const handleConfirmDelete = () => {
    if (commentToDelete) {
      onDeleteComment(commentToDelete);
      setCommentToDelete(null);
    }
  };
  const handleCancelDelete = () => setCommentToDelete(null);

  return (
    <>
      <section
        ref={sectionRef}
        tabIndex={-1}
        className={
          frameless ? className : `border-border overflow-hidden rounded-md border ${className}`
        }
      >
        {!frameless ? (
          <header className="border-border bg-primary flex items-center gap-2 rounded-t-md border-b px-3 py-2">
            <MessageSquare className="h-4 w-4 text-white" />
            <h4 className="text-sm font-medium text-white">
              {title} ({comments.length})
            </h4>
          </header>
        ) : null}

        <div className={frameless ? '' : 'bg-card p-3'}>
          {comments.length > 0 ? (
            /*
             * No `aria-live` here. It only existed once a comment did, so posting the first one
             * mounted the region together with its content, which assistive tech does not
             * reliably announce. When it did fire, the success toast had already said the same
             * thing through its own region, so one action was read out twice.
             */
            <ul className="mb-3 space-y-3">
              {comments
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((comment) => {
                  const name =
                    `${comment.author.firstName ?? ''} ${comment.author.lastName ?? ''}`.trim() ||
                    'Unknown User';
                  const isMine = Boolean(
                    myId && comment.author?.id && String(comment.author.id) === String(myId),
                  );

                  // alignment: my comments right, others left
                  const row = isMine ? 'justify-end' : 'justify-start';
                  const wrapDir = isMine ? 'flex-row-reverse' : 'flex-row';
                  const metaAlign = isMine ? 'text-right' : 'text-left';

                  return (
                    <li key={comment.id} className={`flex ${row}`}>
                      <div className={`flex w-full items-start gap-2 ${wrapDir}`}>
                        {/* avatar */}
                        <div className="flex flex-col items-center gap-2">
                          <Avatar className="h-10 w-10">
                            <AvatarImage
                              src={authorAvatarSrc(comment.author)}
                              alt={name}
                              cropX={comment.author.cropX ?? 0.5}
                              cropY={comment.author.cropY ?? 0.5}
                              zoom={comment.author.zoom ?? 1}
                            />
                            <AvatarFallback>
                              {initials(comment.author.firstName, comment.author.lastName)}
                            </AvatarFallback>
                          </Avatar>
                        </div>

                        {/* bubble */}
                        <div
                          className={`border-border bg-card relative w-fit max-w-[90%] min-w-0 min-w-[65%] rounded-lg border px-3 py-2 break-words shadow sm:max-w-[85%] lg:max-w-[75%] ${
                            isMine ? 'ml-auto' : ''
                          }`}
                        >
                          {/* Delete button - inside bubble top right.
                              `title` alone is an unreliable accessible name (and never
                              surfaces on touch), so the name is an aria-label. The hit
                              area was 16x16; 32x32 matches the icon buttons in the
                              tables and clears the 24x24 minimum target size. */}
                          <button
                            type="button"
                            aria-label="Delete comment"
                            onClick={() => setCommentToDelete(comment.id)}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-full text-xs opacity-70 transition-colors hover:opacity-100"
                            title="Delete comment"
                            disabled={deletingComments[comment.id]}
                            hidden={
                              courseIsArchived ||
                              !myId ||
                              String(comment.author.id) !== String(myId)
                            }
                          >
                            <X className="h-3 w-3 stroke-2" />
                          </button>
                          {/* Who can read this, leading the bubble opposite the delete
                              control. Shown on every comment rather than only the private
                              ones: a missing badge is not a reliable signal, and staff
                              scanning an old thread cannot otherwise tell whether a remark
                              went to one student or to their whole group. */}
                          {audienceLabel(comment) ? (
                            <Badge
                              variant="outline"
                              className={`text-2xs mr-6 mb-1 font-normal ${
                                comment.aboutGroupId
                                  ? 'bg-status-info-bg border-status-info-border text-status-info'
                                  : 'bg-status-warning-bg border-status-warning-border text-status-warning'
                              }`}
                            >
                              {audienceLabel(comment)}
                            </Badge>
                          ) : null}

                          <p className="pr-6 text-sm leading-relaxed whitespace-pre-wrap">
                            {comment.content}
                          </p>

                          <div className="mt-1 flex items-center justify-between gap-1 overflow-hidden whitespace-nowrap">
                            <span className="text-muted-foreground truncate text-xs">{name}</span>
                            <span className={`text-muted-foreground text-xs ${metaAlign}`}>
                              {formatDateTime(comment.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <div className="border-border bg-card text-muted-foreground mb-3 flex items-center justify-center rounded-md border border-dashed py-8">
              <MessageSquare className="mr-2 h-5 w-5 opacity-50" />
              <span>No comments yet.</span>
            </div>
          )}

          <div className="space-y-2">
            <Textarea
              placeholder={placeholder}
              value={commentText}
              onChange={(e) => onCommentTextChange(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  onSaveComment();
                }
              }}
              // --background is the PAGE grey, which reads dark sitting on a white card.
              // --muted is the light surface token meant for a filled control like this.
              className="bg-muted min-h-[80px]"
              aria-label="Add comment"
              hidden={courseIsArchived}
            />
            {/* Group assignments only. Defaults to the whole group, because the shared
                submission is what is on screen, so the choice is stated plainly rather than
                left to be inferred from a default nobody read. */}
            {audience?.group && !courseIsArchived ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-muted-foreground text-xs font-medium">Send comment to:</span>
                <SegmentedControl
                  name="comment-audience"
                  value={audience.target}
                  onValueChange={(v) => audience.onTargetChange(v as 'student' | 'group')}
                  ariaLabel="Who this comment is for"
                  options={[
                    { value: 'group', label: 'Entire group' },
                    { value: 'student', label: `${audience.studentName} only` },
                  ]}
                />
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={onSaveComment}
                disabled={!commentText.trim() || isSaving}
                hidden={courseIsArchived}
              >
                {isSaving ? (
                  'Submitting…'
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" /> Add Comment
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={!!commentToDelete}
        variant="destructive"
        title="Delete comment?"
        description="This permanently deletes the comment and cannot be undone."
        confirmText="Delete comment"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        onCloseAutoFocus={(event) => {
          // The Delete button sat on the comment the confirm has just removed, so the default
          // restore target is gone by the time the dialog closes.
          event.preventDefault();
          sectionRef.current?.focus();
        }}
      />
    </>
  );
}
