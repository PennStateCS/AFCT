-- Assign to everyone (default) or, when false, only to students with an override row.
ALTER TABLE "Assignment" ADD COLUMN "assignedToEveryone" BOOLEAN NOT NULL DEFAULT true;

-- With "assign to specific students", an override row can be a pure assignee marker
-- (all deadline fields null = assigned, inherits the base dates), so the earlier
-- "must change at least one field" check no longer holds.
ALTER TABLE "AssignmentOverride" DROP CONSTRAINT "AssignmentOverride_has_change";
