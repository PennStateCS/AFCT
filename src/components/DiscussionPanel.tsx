"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { MessageSquare, Send, X } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { useEffectiveTimezone } from "@/hooks/use-effective-timezone";
import { formatDateTimeInTimeZone } from "@/lib/date";

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
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return fi + li || "U";
};

const authorAvatarSrc = (author: Comment["author"]) => {
  const raw = author?.avatar ?? author?.avatarUrl ?? null;
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  return `/uploads/${raw}`;
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
  title = "Discussion",
  placeholder = "Add a comment...",
  className = "",
}: Props) {
  const { data: session } = useSession();
  const myId = session?.user?.id ?? null;
  const { timezone } = useEffectiveTimezone();

  const formatDateTime = (iso: string | Date) =>
    formatDateTimeInTimeZone(iso, timezone);

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
      <section className={`rounded-md border border-border overflow-hidden ${className}`}>
        <header className="flex items-center gap-2 border-b border-border bg-primary px-3 py-2 rounded-t-md">
          <MessageSquare className="h-4 w-4 text-white" />
          <h4 className="text-sm font-medium text-white">{title} ({comments.length})</h4>
        </header>

        <div className="bg-card p-3">
          {comments.length > 0 ? (
            <ul className="mb-3 space-y-3">
              {comments
                .sort(
                  (a, b) =>
                    new Date(a.createdAt).getTime() -
                    new Date(b.createdAt).getTime()
                )
                .map((comment) => {
                  const name =
                    `${comment.author.firstName ?? ""} ${
                      comment.author.lastName ?? ""
                    }`.trim() || "Unknown User";
                  const isMine =
                    Boolean(
                      myId &&
                        comment.author?.id &&
                        String(comment.author.id) === String(myId)
                    );

                  // alignment: my comments right, others left
                  const row = isMine ? "justify-end" : "justify-start";
                  const wrapDir = isMine ? "flex-row-reverse" : "flex-row";
                  const metaAlign = isMine ? "text-right" : "text-left";

                  return (
                    <li key={comment.id} className={`flex ${row}`}>
                      <div className={`flex w-full items-start gap-2 ${wrapDir}`}>
                        {/* avatar */}
                        <div className="flex flex-col items-center gap-2">
                          <Avatar className="h-10 w-10">
                            <AvatarImage
                              src={authorAvatarSrc(comment.author)}
                              alt={name}
                            />
                            <AvatarFallback className="bg-secondary text-secondary-foreground">
                              {initials(
                                comment.author.firstName,
                                comment.author.lastName
                              )}
                            </AvatarFallback>
                          </Avatar>
                        </div>

                        {/* bubble */}
                        <div
                          className={`min-w-0 min-w-[65%] w-fit max-w-[90%] sm:max-w-[85%] lg:max-w-[75%] break-words rounded-lg border border-border px-3 py-2 shadow bg-card relative ${
                            isMine ? "ml-auto" : ""
                          }`}
                        >
                          {/* Delete button - inside bubble top right */}
                          <button
                            onClick={() => setCommentToDelete(comment.id)}
                            className="absolute top-1 right-1 h-4 w-4 rounded-full hover:bg-red-100 text-muted-foreground hover:text-red-600 flex items-center justify-center text-xs transition-colors opacity-70 hover:opacity-100"
                            title="Delete comment"
                            disabled={deletingComments[comment.id]}
                            hidden={courseIsArchived}
                          >
                            <X className="h-3 w-3 stroke-2" />
                          </button>
                          
                          <p className="whitespace-pre-wrap text-sm leading-relaxed pr-6">
                            {comment.content}
                          </p>

                          <div className="mt-1 flex items-center justify-between gap-1 overflow-hidden whitespace-nowrap">
                            <span className="truncate text-xs text-muted-foreground">
                              {name}
                            </span>
                            <span
                              className={`text-xs text-muted-foreground ${metaAlign}`}
                            >
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
            <div className="mb-3 flex items-center justify-center rounded-md border border-dashed border-border bg-card py-8 text-muted-foreground">
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
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onSaveComment();
                }
              }}
              className="min-h-[80px] bg-input"
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
                  "Submitting…"
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
