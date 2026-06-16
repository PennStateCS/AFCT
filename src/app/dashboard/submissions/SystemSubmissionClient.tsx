'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Assignment, Course } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { showToast } from '@/lib/toast';

type StatusTone = 'green' | 'amber' | 'red' | 'gray' | 'blue' | 'violet' | 'yellow' | 'lime' | 'pink';

type SubmissionStatusFilter = 'on-time' | 'late' | 'pending' | 'processing' | 'failed' | 'correct' | 'incorrect';

type CourseItem = Pick<Course, 'id' | 'name' | 'code'>;

type AssignmentItem = Pick<Assignment, 'id' | 'title' | 'dueDate'>;

type AssignmentRow = {
  id: string;
  courseId: string;
  courseName: string;
  assignmentTitle: string;
  dueDate?: string | Date | null;
  status: SubmissionStatusFilter;
};

const statusToneClass: Record<StatusTone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  gray: 'bg-slate-400',
  blue: 'bg-sky-500',
  violet: 'bg-violet-500',
  yellow: 'bg-yellow-300',
  lime: 'bg-lime-400',
  pink: 'bg-pink-500',
};

const STATUS_FILTER_OPTIONS: { value: SubmissionStatusFilter; label: string; dot: string }[] = [
  { value: 'on-time', label: 'On time', dot: 'bg-emerald-500' },
  { value: 'late', label: 'Late', dot: 'bg-amber-500' },
  { value: 'pending', label: 'Pending', dot: 'bg-violet-500' },
  { value: 'processing', label: 'Processing', dot: 'bg-yellow-300' },
  { value: 'failed', label: 'Failed', dot: 'bg-pink-500' },
  { value: 'correct', label: 'Correct', dot: 'bg-sky-500' },
  { value: 'incorrect', label: 'Incorrect', dot: 'bg-rose-500' },
];

const getStatusChip = (status: SubmissionStatusFilter): { label: string; tone: StatusTone; title: string } => {
  switch (status) {
    case 'pending':
      return { label: 'Pending', tone: 'violet', title: 'Submission is pending' };
    case 'processing':
      return { label: 'Processing', tone: 'yellow', title: 'Submission is being processed' };
    case 'failed':
      return { label: 'Failed', tone: 'pink', title: 'Submission failed' };
    case 'correct':
      return { label: 'Correct', tone: 'blue', title: 'Submission is correct' };
    case 'incorrect':
      return { label: 'Incorrect', tone: 'red', title: 'Submission is incorrect' };
    case 'late':
      return { label: 'Late', tone: 'amber', title: 'Submission was late' };
    case 'on-time':
    default:
      return { label: 'On time', tone: 'green', title: 'Submission was on time' };
  }
};

const fetchCourseList = async (): Promise<CourseItem[]> => {
  const response = await fetch('/api/courses/list', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to load courses');
  }
  return (await response.json()) as CourseItem[];
};

const fetchAssignmentsForCourse = async (course: CourseItem): Promise<AssignmentRow[]> => {
  const response = await fetch(`/api/courses/${course.id}/assignments`, { cache: 'no-store' });
  if (!response.ok) return [];

  const assignments = (await response.json()) as AssignmentItem[];
  return assignments.map((assignment) => ({
    id: assignment.id,
    courseId: course.id,
    courseName: course.name ?? course.code ?? course.id,
    assignmentTitle: assignment.title,
    dueDate: assignment.dueDate ?? null,
    status: assignment.dueDate ? 'on-time' : 'pending',
  }));
};

export default function SystemSubmissionClient() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [selectedAssignments, setSelectedAssignments] = useState<string[]>([]);
  const [activeFilters, setActiveFilters] = useState<Set<SubmissionStatusFilter>>(new Set());
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const loadCourses = async () => {
      setLoadingCourses(true);
      try {
        const courseList = await fetchCourseList();
        setCourses(courseList);
        setSelectedCourses(courseList.map((course) => course.id));
      } catch (error) {
        console.error(error);
        showToast.error('Unable to load courses');
      } finally {
        setLoadingCourses(false);
      }
    };
    void loadCourses();
  }, []);

  useEffect(() => {
    const loadAssignments = async () => {
      if (selectedCourses.length === 0) {
        setAssignments([]);
        return;
      }

      setLoadingAssignments(true);
      try {
        const rows = await Promise.all(
          selectedCourses.map(async (courseId) => {
            const course = courses.find((item) => item.id === courseId);
            if (!course) return [] as AssignmentRow[];
            return fetchAssignmentsForCourse(course);
          }),
        );
        const flat = rows.flat();
        setAssignments(flat);

        if (!initialized) {
          setSelectedAssignments(flat.map((assignment) => assignment.id));
          setInitialized(true);
        }
      } catch (error) {
        console.error(error);
        showToast.error('Unable to load assignments');
        setAssignments([]);
      } finally {
        setLoadingAssignments(false);
      }
    };
    void loadAssignments();
  }, [selectedCourses, courses, initialized]);

  const courseOptions = useMemo(
    () => courses.map((course) => ({ id: course.id, label: course.name ?? course.code ?? course.id })),
    [courses],
  );

  const assignmentOptions = useMemo(
    () =>
      assignments
        .map((assignment) => ({ id: assignment.id, label: assignment.assignmentTitle }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [assignments],
  );

  const visibleAssignments = useMemo(
    () =>
      assignments.filter((assignment) => {
        const matchesCourse = selectedCourses.length === 0 || selectedCourses.includes(assignment.courseId);
        const matchesAssignment = selectedAssignments.length === 0 || selectedAssignments.includes(assignment.id);
        const matchesFilter = activeFilters.size === 0 || activeFilters.has(assignment.status);
        return matchesCourse && matchesAssignment && matchesFilter;
      }),
    [activeFilters, assignments, selectedAssignments, selectedCourses],
  );

  const toggleFilter = (filter: SubmissionStatusFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedCourses(courses.map((course) => course.id));
    setSelectedAssignments(assignments.map((assignment) => assignment.id));
  };

  const handleClearAll = () => {
    setSelectedCourses([]);
    setSelectedAssignments([]);
  };

  const handleRerunVisible = async () => {
    if (visibleAssignments.length === 0) return;

    const courseIds = Array.from(new Set(visibleAssignments.map((assignment) => assignment.courseId)));
    setRerunning(true);
    try {
      for (const courseId of courseIds) {
        const response = await fetch(`/api/course_submissions/${courseId}`, {
          method: 'POST',
        });
        if (!response.ok) {
          throw new Error(`Failed to rerun course ${courseId}`);
        }
      }
      showToast.success(`Requested rerun for ${visibleAssignments.length} visible items.`);
    } catch (error) {
      console.error(error);
      showToast.error('Failed to rerun visible items.');
    } finally {
      setRerunning(false);
    }
  };

  return (
    <Card className="p-4">
      <CardHeader className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle role="heading" aria-level={1} className="text-2xl">
            System Submission Logs
          </CardTitle>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleRerunVisible}
          disabled={visibleAssignments.length === 0 || rerunning}
          className="whitespace-nowrap"
        >
          {rerunning ? 'Rerunning…' : 'Rerun'}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={handleSelectAll} disabled={courses.length === 0}>
            Select all
          </Button>
          <Button size="sm" variant="outline" onClick={handleClearAll}>
            Clear all
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          <SearchableMultiSelect
            label="Course filter"
            items={courseOptions}
            value={selectedCourses}
            onChange={setSelectedCourses}
            placeholder={loadingCourses ? 'Loading courses…' : 'No selected courses'}
            searchPlaceholder="Search courses"
            emptyStateText={loadingCourses ? 'Loading courses…' : 'No courses found.'}
            disabled={loadingCourses}
          />
          <SearchableMultiSelect
            label="Assignment filter"
            items={assignmentOptions}
            value={selectedAssignments}
            onChange={setSelectedAssignments}
            placeholder={loadingAssignments ? 'Loading assignments…' : 'No selected assignments'}
            searchPlaceholder="Search assignments"
            emptyStateText={loadingAssignments ? 'Loading assignments…' : 'No assignments found.'}
            disabled={loadingAssignments || selectedCourses.length === 0}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveFilters(new Set())}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              activeFilters.size === 0
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground'
            }`}
          >
            All
          </button>
          {STATUS_FILTER_OPTIONS.map(({ value, label, dot }) => {
            const active = activeFilters.has(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleFilter(value)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground'
                }`}
              >
                <span className={`inline-flex h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-2">Course</TableHead>
                <TableHead className="px-2 py-2">Assignment</TableHead>
                <TableHead className="px-2 py-2">Due</TableHead>
                <TableHead className="px-2 py-2">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleAssignments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground py-8 text-center text-sm">
                    {loadingCourses || loadingAssignments
                      ? 'Loading visible items...'
                      : 'No assignments match your current filters.'}
                  </TableCell>
                </TableRow>
              ) : (
                visibleAssignments.map((assignment) => {
                  const statusChip = getStatusChip(assignment.status);
                  return (
                    <TableRow key={`${assignment.courseId}-${assignment.id}`} className="hover:bg-slate-50">
                      <TableCell className="px-2 py-2 align-top">{assignment.courseName}</TableCell>
                      <TableCell className="px-2 py-2 align-top">{assignment.assignmentTitle}</TableCell>
                      <TableCell className="px-2 py-2 align-top">
                        {assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No due date'}
                      </TableCell>
                      <TableCell className="px-2 py-2 align-top">
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium">
                          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${statusToneClass[statusChip.tone]}`} aria-hidden="true" />
                          {statusChip.label}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
