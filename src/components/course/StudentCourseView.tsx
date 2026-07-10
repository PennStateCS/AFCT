'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StudentGradesCard } from '@/components/StudentGradesCard';
import { StudentAssignmentCard } from '@/components/StudentAssignmentCard';
import type { FullCourse, TabType } from '@/types/course';
import { BookOpen, Table } from 'lucide-react';

interface StudentCourseViewProps {
  course: FullCourse;
  tab: TabType;
  onTabChange: (value: string) => void;
}

export function StudentCourseView({ course, tab, onTabChange }: StudentCourseViewProps) {
  return (
    <Tabs defaultValue="assignments" value={tab} onValueChange={onTabChange}>
      <TabsList
        aria-label="Course sections"
        className="bg-card border-border h-12 w-full justify-start gap-1 overflow-x-auto rounded-md border p-1 shadow-sm"
      >
        <TabsTrigger
          id="tab-assignments"
          aria-controls="panel-assignments"
          aria-label={`Assignments (${course.assignments.length})`}
          className="data-[state=active]:bg-secondary hover:bg-accent px-4 whitespace-nowrap data-[state=active]:text-white"
          value="assignments"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Assignments
          </div>
        </TabsTrigger>

        <TabsTrigger
          id="tab-grades"
          aria-controls="panel-grades"
          className="data-[state=active]:bg-secondary hover:bg-accent px-4 whitespace-nowrap data-[state=active]:text-white"
          value="grades"
        >
          <div className="flex items-center gap-2">
            <Table className="h-4 w-4" />
            Grades
          </div>
        </TabsTrigger>
      </TabsList>

      <TabsContent
        id="panel-assignments"
        aria-labelledby="tab-assignments"
        value="assignments"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        {tab === 'assignments' ? (
          <div className="space-y-6">
            <StudentAssignmentCard course={course} />
          </div>
        ) : null}
      </TabsContent>

      <TabsContent
        id="panel-grades"
        aria-labelledby="tab-grades"
        value="grades"
        className="animate-fade-in-up transition-opacity duration-300"
      >
        {tab === 'grades' ? (
          <div className="mb-8 space-y-6">
            <StudentGradesCard courseId={course.id} />
          </div>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
