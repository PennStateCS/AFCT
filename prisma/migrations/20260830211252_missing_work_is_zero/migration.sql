-- Whether unsubmitted work counts as zero once its deadline has passed.
--
-- The column defaults true so that every assignment created from here on has it on, which is
-- what was asked for, and so that none of the five places that create an assignment has to
-- remember to set it. Existing assignments are then switched off below: turning this on
-- retroactively would change the grades and averages shown in every course that already exists,
-- including finished ones, without anybody deciding to.
ALTER TABLE "Assignment" ADD COLUMN     "missingWorkIsZero" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Assignment" SET "missingWorkIsZero" = false;

-- When a problem was attached to an assignment.
--
-- Needed so that adding a problem to an already-overdue assignment does not instantly mark the
-- whole class as missing it.
ALTER TABLE "AssignmentProblem" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfilled from the assignment rather than left at "now".
--
-- The column default would claim every problem in the database was attached at the moment of
-- this migration, which is after almost every deadline that has already passed, so the guard
-- above would read the entire history as "added late" and exempt all of it. The assignment's own
-- creation date is the honest approximation: these problems were there when it was built.
UPDATE "AssignmentProblem" ap
SET    "createdAt" = a."createdAt"
FROM   "Assignment" a
WHERE  a."id" = ap."assignmentId";
