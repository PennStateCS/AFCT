'use client';

import type { User } from '@prisma/client';
import { sortRoster, type EnrolledUser } from '@/lib/course-roster';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus, Users, GraduationCap } from 'lucide-react';

interface RosterCardProps {
  courseIsArchived: boolean;
  // enrolled: list of users with courseRole and optional flags
  enrolled?: EnrolledUser[];
  userColumns: ColumnDef<User>[];
  onEnrollUser: () => void;
  onBulkEnroll?: () => void;
  loading?: boolean;
}

export function RosterCard({
  courseIsArchived,
  enrolled = [],
  userColumns,
  onEnrollUser,
  onBulkEnroll,
  loading = false,
}: RosterCardProps) {
  // Use a shared sort helper to keep ordering consistent
  const rosterData = sortRoster(enrolled).map((u) => ({
    ...u,
    role: u.role === 'ADMIN' ? 'ADMIN' : (u.courseRole ?? u.role),
  }));

  return (
    <div className="space-y-4">
      {/* Stacked below sm, side by side above it: the two buttons plus the heading do not
          fit on a phone, and a single row pushed them off the edge. Same shape as the
          User Accounts header. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <GraduationCap className="h-5 w-5" />
          Roster
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="default" onClick={onEnrollUser} hidden={courseIsArchived}>
            <Plus />
            Enroll User
          </Button>
          <Button variant="default" onClick={() => onBulkEnroll?.()} hidden={courseIsArchived}>
            <Users className="mr-1" />
            Bulk Enroll
          </Button>
        </div>
      </div>
      <DataTable
        columns={userColumns as ColumnDef<User>[]}
        data={rosterData as unknown as User[]}
        loading={loading}
        tableLabel="Course roster table"
        defaultSorting={[{ id: 'lastName', desc: false }]}
        emptyTitle="No one enrolled yet"
        emptyDescription={
          courseIsArchived
            ? 'This course was archived with an empty roster.'
            : 'Use Enroll User or Bulk Enroll to add students and staff.'
        }
        emptyIcon={GraduationCap}
        loadingMessage="Loading roster, please wait..."
      />
    </div>
  );
}
