-- CreateIndex
CREATE INDEX "Assignment_courseId_idx" ON "Assignment"("courseId");

-- CreateIndex
CREATE INDEX "Assignment_isPublished_idx" ON "Assignment"("isPublished");

-- CreateIndex
CREATE INDEX "Assignment_dueDate_idx" ON "Assignment"("dueDate");

-- CreateIndex
CREATE INDEX "Assignment_courseId_isPublished_idx" ON "Assignment"("courseId", "isPublished");

-- CreateIndex
CREATE INDEX "Comment_assignmentId_idx" ON "Comment"("assignmentId");

-- CreateIndex
CREATE INDEX "Comment_problemId_idx" ON "Comment"("problemId");

-- CreateIndex
CREATE INDEX "Comment_rosterId_idx" ON "Comment"("rosterId");

-- CreateIndex
CREATE INDEX "Comment_aboutStudentId_idx" ON "Comment"("aboutStudentId");

-- CreateIndex
CREATE INDEX "Comment_assignmentId_problemId_idx" ON "Comment"("assignmentId", "problemId");

-- CreateIndex
CREATE INDEX "Comment_assignmentId_problemId_aboutStudentId_idx" ON "Comment"("assignmentId", "problemId", "aboutStudentId");

-- CreateIndex
CREATE INDEX "Comment_createdAt_idx" ON "Comment"("createdAt");

-- CreateIndex
CREATE INDEX "Course_isPublished_idx" ON "Course"("isPublished");

-- CreateIndex
CREATE INDEX "Course_createdAt_idx" ON "Course"("createdAt");

-- CreateIndex
CREATE INDEX "Problem_courseId_idx" ON "Problem"("courseId");

-- CreateIndex
CREATE INDEX "Problem_type_idx" ON "Problem"("type");

-- CreateIndex
CREATE INDEX "Problem_createdAt_idx" ON "Problem"("createdAt");

-- CreateIndex
CREATE INDEX "Roster_courseId_idx" ON "Roster"("courseId");

-- CreateIndex
CREATE INDEX "Roster_userId_idx" ON "Roster"("userId");

-- CreateIndex
CREATE INDEX "Roster_role_idx" ON "Roster"("role");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_inactive_idx" ON "User"("inactive");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
