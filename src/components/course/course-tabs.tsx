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

// Underline navigation: a light bar on the card's own (white) background with a
// subtle bottom border. Overrides the segmented/filled defaults from TabsList.
const LIST_CLASS =
  'h-auto w-full items-center justify-start gap-6 overflow-x-auto overflow-y-hidden rounded-none border-b border-border bg-transparent p-0';

// Each trigger is a content-width item with a transparent bottom border that
// turns teal (and its text teal + bolder) when active, sitting just above the
// bar's own bottom border. No negative margin here: it would push the trigger
// 1px past the scroll container and produce a phantom vertical scrollbar.
const TRIGGER_CLASS = [
  'text-muted-foreground hover:text-foreground',
  'data-[state=active]:text-teal-600 dark:data-[state=active]:text-teal-400 data-[state=active]:font-semibold',
  'inline-flex h-auto min-w-36 flex-none items-center justify-center gap-1.5 whitespace-nowrap',
  'rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 py-3 text-sm font-medium',
  'transition-colors',
  'data-[state=active]:border-teal-600 dark:data-[state=active]:border-teal-400',
  'data-[state=active]:bg-transparent data-[state=active]:shadow-none',
].join(' ');

/** Counts rendered as a small subtle badge next to the label. Absent → none. */
type TabCounts = Partial<Record<TabType, number>>;

export function CourseTabBar({ counts }: { counts?: TabCounts }) {
  return (
    <TabsList aria-label="Course content sections" className={LIST_CLASS}>
      {COURSE_TABS.map(({ value, label, Icon }) => {
        const count = counts?.[value];
        return (
          <TabsTrigger
            key={value}
            id={`tab-${value}`}
            aria-controls={`panel-${value}`}
            aria-label={count === undefined ? label : `${label}, ${count}`}
            className={TRIGGER_CLASS}
            value={value}
          >
            <Icon className="size-3.5 opacity-70" />
            {label}
            {count !== undefined && (
              <span className="ml-0.5 rounded-full bg-teal-100 px-1.5 py-0.5 text-xs leading-none font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                {count}
              </span>
            )}
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
    <TabsContent id={`panel-${value}`} aria-labelledby={`tab-${value}`} value={value}>
      {active ? <div className="mb-8 space-y-6">{children}</div> : null}
    </TabsContent>
  );
}
