'use client';

import { User } from '@prisma/client';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus, Users } from 'lucide-react';

type UserWithRole = User & {
  _role: string;
};

interface RosterCardProps {
  faculty: User[];
  tas: User[];
  students: User[];
  userColumns: ColumnDef<User>[];
  onEnrollUser: () => void;
  onBulkEnroll?: () => void;
}

export function RosterCard({ 
  faculty, 
  tas, 
  students, 
  userColumns, 
  onEnrollUser 
  , onBulkEnroll
}: RosterCardProps) {
  const rosterData: UserWithRole[] = [
    ...faculty.map((u) => ({ ...u, _role: 'Faculty' })),
    ...tas.map((u) => ({ ...u, _role: 'TA' })),
    ...students.map((u) => ({ ...u, _role: 'Student' })),
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-2xl">Course Roster</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={onEnrollUser}>
            <Plus />Enroll User
          </Button>
          <Button variant="default" onClick={() => onBulkEnroll?.()}>
            <Users className="mr-1" />Bulk Enroll
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={userColumns as ColumnDef<UserWithRole>[]}
          data={rosterData}
        />
      </CardContent>
    </Card>
  );
}
