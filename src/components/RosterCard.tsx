'use client';


import { User } from '@prisma/client';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus, Users } from 'lucide-react';

interface RosterCardProps {
  courseIsArchived: boolean;
  faculty: User[];
  tas: User[];
  students: User[];
  userColumns: ColumnDef<User>[];
  onEnrollUser: () => void;
  onBulkEnroll?: () => void;
  loading?: boolean;
}

export function RosterCard({
  courseIsArchived,
  faculty,
  tas,
  students,
  userColumns,
  onEnrollUser,
  onBulkEnroll,
  loading = false,
}: RosterCardProps) {

  const unsortedRosterData: User[] = [
    ...faculty.map((u) => ({ ...u })),
    ...tas.map((u) => ({ ...u })),
    ...students.map((u) => ({ ...u })),
  ];
  const rolePriority: Record<string, number> = { 'ADMIN': 0, 'FACULTY': 1, 'TA': 2, 'STUDENT': 3 };
  const rosterData: User[] = unsortedRosterData.slice().sort((a, b) => {
    const roleA = rolePriority[a.role] ?? 99;
    const roleB = rolePriority[b.role] ?? 99;
    if (roleA !== roleB) {
      return roleA - roleB;
    }
    
    // If roles are equal, sort by last name (case-insensitive)
    const lastA = (a.lastName || '').toLowerCase();
    const lastB = (b.lastName || '').toLowerCase();
    if (lastA < lastB) return -1;
    if (lastA > lastB) return 1;
    return 0;
  });

  return (
    <Card className="p-4">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-2xl flex items-center gap-2">
          <Users className="h-5 w-5" />Roster
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={onEnrollUser} hidden={courseIsArchived}>
            <Plus />Enroll User
          </Button>
          <Button variant="default" onClick={() => onBulkEnroll?.()} hidden={courseIsArchived}>
            <Users className="mr-1" />Bulk Enroll
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable columns={userColumns as ColumnDef<User>[]} data={rosterData} loading={loading} />
      </CardContent>
    </Card>
  );
}
