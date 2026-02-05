'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { MessageSquare, Send, X } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ConfirmDialog } from './dialogs/ConfirmDialog';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';

export type Comment = {
  id: string;
  content: string;
  createdAt: string;
  author: {
    id?: string;
    firstName: string | null;
    lastName: string | null;
    role?: string | null;
    avatar?: string | null;
    avatarUrl?: string | null;
  };
};

type Props = {
  courseIsArchived: boolean;
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
};

// helpers
const initials = (first?: string | null, last?: string | null) => {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  const fi = f ? f[0].toUpperCase() : '';
  const li = l ? l[0].toUpperCase() : '';
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
  return `/api/uploads/pfps/${raw}`;
};

export default function DiscussionPanel({
  courseIsArchived,
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
}: Props) {
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
      <section className={`border-border overflow-hidden rounded-md border ${className}`}>
        <header className="border-border bg-primary flex items-center gap-2 rounded-t-md border-b px-3 py-2">
          <MessageSquare className="h-4 w-4 text-white" />
          <h4 className="text-sm font-medium text-white">
            {title} ({comments.length})
          </h4>
        </header>

        <div className="bg-card p-3">
          {comments.length > 0 ? (
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
                            <AvatarImage src={authorAvatarSrc(comment.author)} alt={name} />
                            <AvatarFallback className="bg-secondary text-secondary-foreground">
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
                          {/* Delete button - inside bubble top right */}
                          <button
                            onClick={() => setCommentToDelete(comment.id)}
                            className="text-muted-foreground absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full text-xs opacity-70 transition-colors hover:bg-red-100 hover:text-red-600 hover:opacity-100"
                            title="Delete comment"
                            disabled={deletingComments[comment.id]}
                            hidden={courseIsArchived}
                          >
                            <X className="h-3 w-3 stroke-2" />
                          </button>

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
              className="bg-background min-h-[80px]"
              aria-label="Add comment"
              hidden={courseIsArchived}
            />
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
        title="Delete Comment"
        description="Are you sure you want to delete this comment? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </>
  );
}
