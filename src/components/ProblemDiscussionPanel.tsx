'use client';

import type { Comment as DiscussionComment, CommentAudience } from './DiscussionPanel';
import DiscussionPanel from './DiscussionPanel';

export type ProblemDiscussionPanelProps = {
  courseIsArchived: boolean;
  /** Group assignments only: who a new comment reaches. Omit for individual ones. */
  audience?: CommentAudience | null;
  subjectName?: string;
  comments: DiscussionComment[];
  commentText: string;
  onCommentTextChange: (text: string) => void;
  onSaveComment: () => void;
  onDeleteComment: (id: string) => void;
  isSaving?: boolean;
  deletingComments?: Record<string, boolean>;
};

export default function ProblemDiscussionPanel({
  courseIsArchived,
  audience,
  subjectName,
  comments,
  commentText,
  onCommentTextChange,
  onSaveComment,
  onDeleteComment,
  isSaving,
  deletingComments,
}: ProblemDiscussionPanelProps) {
  return (
    <DiscussionPanel
      courseIsArchived={courseIsArchived}
      audience={audience}
      subjectName={subjectName}
      comments={comments}
      commentText={commentText}
      onCommentTextChange={onCommentTextChange}
      onSaveComment={onSaveComment}
      onDeleteComment={onDeleteComment}
      isSaving={isSaving}
      deletingComments={deletingComments}
      placeholder="Add a comment about this problem…"
      className="min-w-0 flex-1"
      frameless
    />
  );
}
