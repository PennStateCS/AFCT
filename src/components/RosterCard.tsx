'use client';

import type { User } from '@prisma/client';
import { sortRoster, type EnrolledUser } from '@/lib/course-utils';
import type { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card className="p-4">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="flex items-center gap-2 text-2xl">
          <GraduationCap className="h-5 w-5" />
          Roster
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={onEnrollUser} hidden={courseIsArchived}>
            <Plus />
            Enroll User
          </Button>
          <Button variant="default" onClick={() => onBulkEnroll?.()} hidden={courseIsArchived}>
            <Users className="mr-1" />
            Bulk Enroll
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={userColumns as ColumnDef<User>[]}
          data={rosterData as unknown as User[]}
          loading={loading}
          tableLabel="Course roster table"
        />
      </CardContent>
    </Card>
  );
}
