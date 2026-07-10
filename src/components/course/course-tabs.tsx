'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  FileText,
  GraduationCap,
  Settings,
  Table,
  Users,
} from 'lucide-react';

import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TabType } from '@/types/course';

type CourseTabDef = {
  value: TabType;
  label: string;
  /** Icon shown in the tab; kept in sync with the matching panel heading. */
  Icon: LucideIcon;
};

/**
 * Single source of truth for the course tabs. The icons here intentionally match
 * the heading icon of each tab's panel (e.g. Assignments → BookOpen), so the tab
 * bar and the content below it always agree.
 */
export const COURSE_TABS: readonly CourseTabDef[] = [
  { value: 'assignments', label: 'Assignments', Icon: BookOpen },
  { value: 'problems', label: 'Problems', Icon: FileText },
  { value: 'roster', label: 'Roster', Icon: GraduationCap },
  { value: 'grades', label: 'Grades', Icon: Table },
  { value: 'groups', label: 'Groups', Icon: Users },
  { value: 'activity', label: 'Activity', Icon: Activity },
  { value: 'settings', label: 'Settings', Icon: Settings },
] as const;

const TRIGGER_CLASS =
  'data-[state=active]:bg-secondary hover:bg-accent px-4 whitespace-nowrap data-[state=active]:text-white';

/** Counts appended to a tab label, e.g. `Assignments (3)`. Absent → no count. */
type TabCounts = Partial<Record<TabType, number>>;

export function CourseTabBar({ counts }: { counts?: TabCounts }) {
  return (
    <TabsList
      aria-label="Course content sections"
      className="bg-card border-border h-12 w-full justify-start gap-1 overflow-x-auto rounded-md border p-1 shadow-sm"
    >
      {COURSE_TABS.map(({ value, label, Icon }) => {
        const count = counts?.[value];
        const text = count === undefined ? label : `${label} (${count})`;
        return (
          <TabsTrigger
            key={value}
            id={`tab-${value}`}
            aria-controls={`panel-${value}`}
            aria-label={text}
            className={TRIGGER_CLASS}
            value={value}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              {text}
            </div>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

/**
 * A tab's content region. Mounts its children only while active (matching the
 * previous `tab === value ? … : null` gating) and keeps the shared spacing.
 */
export function CourseTabPanel({
  value,
  active,
  children,
}: {
  value: TabType;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <TabsContent
      id={`panel-${value}`}
      aria-labelledby={`tab-${value}`}
      value={value}
      className="animate-fade-in-up transition-opacity duration-300"
    >
      {active ? <div className="mb-8 space-y-6">{children}</div> : null}
    </TabsContent>
  );
}
