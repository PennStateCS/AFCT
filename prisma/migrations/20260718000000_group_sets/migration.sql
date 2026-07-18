-- Group Sets: redesigned course group management. A course has many group sets;
-- a set has many groups; a group has many student members. A student belongs to
-- at most one group per set (enforced by GroupMembership_groupSetId_userId_key,
-- which also blocks concurrent double-assignment). Composite foreign keys tie a
-- membership's group to its set and its (courseId, userId) to a real Roster row.
-- Independent of the legacy Group / GroupRoster tables, which are untouched.

-- CreateTable
CREATE TABLE "GroupSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupSetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMembership" (
    "id" TEXT NOT NULL,
    "groupSetId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupSet_courseId_idx" ON "GroupSet"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSet_courseId_name_key" ON "GroupSet"("courseId", "name");

-- CreateIndex
CREATE INDEX "StudentGroup_groupSetId_idx" ON "StudentGroup"("groupSetId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentGroup_groupSetId_name_key" ON "StudentGroup"("groupSetId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StudentGroup_id_groupSetId_key" ON "StudentGroup"("id", "groupSetId");

-- CreateIndex
CREATE INDEX "GroupMembership_groupId_groupSetId_idx" ON "GroupMembership"("groupId", "groupSetId");

-- CreateIndex
CREATE INDEX "GroupMembership_courseId_userId_idx" ON "GroupMembership"("courseId", "userId");

-- CreateIndex
CREATE INDEX "GroupMembership_userId_idx" ON "GroupMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMembership_groupSetId_userId_key" ON "GroupMembership"("groupSetId", "userId");

-- AddForeignKey
ALTER TABLE "GroupSet" ADD CONSTRAINT "GroupSet_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_groupSetId_fkey" FOREIGN KEY ("groupSetId") REFERENCES "GroupSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_groupId_groupSetId_fkey" FOREIGN KEY ("groupId", "groupSetId") REFERENCES "StudentGroup"("id", "groupSetId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_courseId_userId_fkey" FOREIGN KEY ("courseId", "userId") REFERENCES "Roster"("courseId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
