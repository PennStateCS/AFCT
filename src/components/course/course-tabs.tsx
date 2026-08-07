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
// The gap tightens as the viewport shrinks so the strip condenses (rather than
// overflowing) before {@link TabBar} swaps it for the mobile select below `md`.
// Exported so other in-card tab bars (e.g. the assignment page) match this one.
export const TAB_BAR_LIST_CLASS =
  'h-auto w-full items-center justify-start gap-2 lg:gap-6 overflow-x-auto overflow-y-hidden rounded-none border-b border-border bg-transparent p-0';

// Each trigger is a content-width item with a transparent bottom border that
// turns teal (and its text teal + bolder) when active, sitting just above the
// bar's own bottom border. The uniform 144px min-width only kicks in at `lg`; below
// that each tab shrinks to its label so more of them fit before the mobile select
// takes over. No negative margin here: it would push the trigger 1px past the scroll
// container and produce a phantom vertical scrollbar.
export const TAB_BAR_TRIGGER_CLASS = [
  'text-muted-foreground hover:text-foreground',
  // Active label + underline use the --tab-active brand token (teal-700 in light, chosen
  // so 14px text clears WCAG AA 4.5:1 on the card; teal-400 in dark). It carries its own
  // dark value, so no dark: variant is needed. Interim brand accent until the redesign.
  'data-[state=active]:text-tab-active data-[state=active]:font-semibold',
  'inline-flex h-auto lg:min-w-36 flex-none items-center justify-center gap-1.5 whitespace-nowrap',
  'rounded-none border-0 border-b-2 border-transparent bg-transparent px-2 py-3 text-sm font-medium lg:px-1',
  'transition-colors',
  'data-[state=active]:border-tab-active',
  'data-[state=active]:bg-transparent data-[state=active]:shadow-none',
].join(' ');

/** Counts rendered as a small subtle badge next to the label. Absent → none. */
type TabCounts = Partial<Record<TabType, number>>;

/** One option for the mobile section picker. */
export type TabBarItem = { value: string; label: string; count?: number };

/**
 * Mobile fallback for an in-card tab bar. The underline strip needs more width
 * than a phone has, and a horizontally-scrolling strip is easy to miss and awkward
 * to operate, so below `md` we swap it for a plain select that drives the same tab
 * value. {@link TabBar} hides the paired TabsList below `md` so exactly one control is
 * visible at a time. Bound to the same controlled value as the Tabs root, so changing
 * either keeps them in sync.
 */
export function TabBarMobileSelect({
  items,
  value,
  onValueChange,
  label,
  id,
}: {
  items: readonly TabBarItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name for the picker (matches the TabsList aria-label). */
  label: string;
  /** Unique id so the visually-hidden label associates with the select. */
  id: string;
}) {
  return (
    <div className="md:hidden">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="border-border bg-background focus-visible:ring-ring h-11 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.count === undefined ? item.label : `${item.label} (${item.count})`}
          </option>
        ))}
      </select>
    </div>
  );
}

/** One tab in the shared {@link TabBar}. Icon and count are optional. */
export type TabBarTab = { value: string; label: string; Icon?: LucideIcon; count?: number };

/**
 * The shared in-card tab bar. One primitive drives every tab strip in the app
 * (course page, assignment page, System Status, System Settings): the underline
 * strip on `sm` and up, a select fallback below it (see {@link TabBarMobileSelect}).
 * Bind `value`/`onValueChange` to the same controlled state as the Tabs root.
 *
 * Optional features per call: `Icon` and `count` per tab; `linkPanels` emits explicit
 * `tab-*`/`panel-*` ids to pair with {@link CourseTabPanel} (other callers rely on
 * Radix's own trigger/panel wiring).
 */
export function TabBar({
  tabs,
  value,
  onValueChange,
  ariaLabel,
  selectId,
  linkPanels = false,
}: {
  tabs: readonly TabBarTab[];
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name shared by the strip and the mobile select. */
  ariaLabel: string;
  /** Unique id for the mobile select (so its hidden label associates). */
  selectId: string;
  linkPanels?: boolean;
}) {
  return (
    <>
      <TabBarMobileSelect
        id={selectId}
        label={ariaLabel}
        value={value}
        onValueChange={onValueChange}
        items={tabs.map((t) => ({ value: t.value, label: t.label, count: t.count }))}
      />
      <TabsList aria-label={ariaLabel} className={`${TAB_BAR_LIST_CLASS} hidden md:flex`}>
        {tabs.map(({ value: tabValue, label, Icon, count }) => (
          <TabsTrigger
            key={tabValue}
            value={tabValue}
            className={TAB_BAR_TRIGGER_CLASS}
            // With a count, spell it into the accessible name; otherwise the visible
            // label already names the tab.
            aria-label={count === undefined ? undefined : `${label}, ${count}`}
            {...(linkPanels ? { id: `tab-${tabValue}`, 'aria-controls': `panel-${tabValue}` } : {})}
          >
            {Icon ? <Icon className="size-3.5 opacity-70" aria-hidden="true" /> : null}
            {label}
            {count !== undefined ? (
              <span className="bg-tab-active-bg text-tab-active ml-0.5 rounded-full px-1.5 py-0.5 text-xs leading-none font-medium">
                {count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </>
  );
}

/** The course page's tab strip: {@link TabBar} preloaded with COURSE_TABS + counts. */
export function CourseTabBar({
  counts,
  value,
  onValueChange,
}: {
  counts?: TabCounts;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <TabBar
      ariaLabel="Course content sections"
      selectId="course-tab-select"
      value={value}
      onValueChange={onValueChange}
      linkPanels
      tabs={COURSE_TABS.map((t) => ({
        value: t.value,
        label: t.label,
        Icon: t.Icon,
        count: counts?.[t.value],
      }))}
    />
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
