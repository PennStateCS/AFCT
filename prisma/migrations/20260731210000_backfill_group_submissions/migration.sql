-- Group assignments now count submissions group-wide: the members share one set and one cap.
--
-- Submissions written before that change were recorded with a null studentGroupId even on a
-- group assignment, because the submitting code only recognised a group when the assignment
-- carried a GROUP assignee or override row, and the default targeting carries neither. Left
-- alone, those rows would fall outside the new group-scoped count, so every existing group
-- would silently start again from zero attempts.
--
-- Fill in the group each of those submissions was really made in: the submitter's group in
-- the assignment's own group set. Only touches rows that have no group yet, so it is safe to
-- re-run, and it cannot move a submission between groups.
UPDATE "Submission" s
SET "studentGroupId" = gm."groupId"
FROM "Assignment" a, "GroupMembership" gm
WHERE s."assignmentId" = a."id"
  AND a."groupSetId" IS NOT NULL
  AND s."studentGroupId" IS NULL
  AND gm."groupSetId" = a."groupSetId"
  AND gm."userId" = s."studentId";
