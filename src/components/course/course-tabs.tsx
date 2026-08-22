'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Activity, BookOpen, FileText, GraduationCap, Settings, Table, Users } from 'lucide-react';

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
  // Active tab: the sidebar's own charcoal, a white label, and the brand teal underline that
  // matches the header bar. The sidebar token rather than a literal, so the active tab follows
  // the sidebar in both themes instead of drifting from it; white on that charcoal is
  // comfortably past AA. The underline is decoration, so the lighter teal is fine there.
  'data-[state=active]:text-white data-[state=active]:font-semibold',
  // `group` so the count badge can react to the tab's own active state.
  'group inline-flex h-auto items-center justify-center gap-1.5 whitespace-nowrap',
  'rounded-none border-0 border-b-4 border-transparent bg-transparent px-2 py-3 text-sm font-medium lg:px-1',
  'transition-colors',
  'data-[state=active]:border-brand-teal',
  // Set for both themes explicitly. The base trigger fills only in dark
  // (`dark:data-[state=active]:bg-input/30`), which the old `bg-transparent` never cancelled,
  // so light mode showed the card straight through and the two themes disagreed.
  'data-[state=active]:bg-sidebar dark:data-[state=active]:bg-sidebar',
  'data-[state=active]:shadow-none',
].join(' ');

/**
 * Width behaviour for the strip.
 *
 * `fill` shares the width evenly, which suits a bar of six or more tabs: it uses the space the
 * card already has instead of huddling the tabs at the left. With only a few tabs it looks
 * wrong, stretching three items across a wide card, so those pass `fill={false}` and keep their
 * natural width.
 */
const FILL_TRIGGER_CLASS = 'flex-1 min-w-0';
const NATURAL_TRIGGER_CLASS = 'lg:min-w-36 flex-none';

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
  fill = true,
}: {
  tabs: readonly TabBarTab[];
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name shared by the strip and the mobile select. */
  ariaLabel: string;
  /** Unique id for the mobile select (so its hidden label associates). */
  selectId: string;
  linkPanels?: boolean;
  /** Share the full width between tabs. Turn off for a bar with only a few. */
  fill?: boolean;
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
            className={`${TAB_BAR_TRIGGER_CLASS} ${fill ? FILL_TRIGGER_CLASS : NATURAL_TRIGGER_CLASS}`}
            // With a count, spell it into the accessible name; otherwise the visible
            // label already names the tab.
            aria-label={count === undefined ? undefined : `${label}, ${count}`}
            {...(linkPanels ? { id: `tab-${tabValue}`, 'aria-controls': `panel-${tabValue}` } : {})}
          >
            {/*
             * Hidden between `md` and `lg`, where the strip is tight enough that the icons
             * cost more room than they add meaning. Below `md` the select replaces the strip
             * entirely, so there is nothing to hide there.
             */}
            {Icon ? (
              <Icon className="hidden size-3.5 opacity-70 lg:inline" aria-hidden="true" />
            ) : null}
            <span className="truncate">{label}</span>
            {count !== undefined ? (
              <span className="bg-tab-active-bg text-tab-active group-data-[state=active]:bg-background ml-0.5 rounded-full px-1.5 py-0.5 text-xs leading-none font-medium">
                {count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </>
  );
}

// The vertical rail (see {@link CourseTabBar}). Light and quiet on purpose: the global
// sidebar is the dark one, and two charcoal columns would read as two applications.
const RAIL_TRIGGER_CLASS = [
  // `group` so the count badge can react to the item's own active state.
  'group flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm',
  'justify-start whitespace-nowrap',
  'text-muted-foreground hover:bg-accent hover:text-foreground',
  // Active: a soft tint of the primary, not a filled row. The dark pair is spelled out
  // because primary at 10% behind primary text is 2.8:1 on a dark card, under the floor.
  'data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:font-medium',
  'dark:data-[state=active]:bg-blue-950/40 dark:data-[state=active]:text-blue-300',
  'data-[state=active]:shadow-none',
  'border-0 bg-transparent transition-colors',
].join(' ');

/**
 * The course sections as a vertical rail, for wide screens.
 *
 * Still a Radix tablist, not a `<nav>`: the panels are tab panels and behave as such, so
 * converting the semantics for the sake of the shape would be a regression. The Tabs root
 * carries `orientation="vertical"` (set by the caller) so arrow keys run up and down.
 */
function CourseTabRail({ tabs, ariaLabel }: { tabs: readonly TabBarTab[]; ariaLabel: string }) {
  return (
    // A surface rather than a rule down the page: the divider split the workspace in two
    // instead of grouping the items. self-start so it stays the height of its own list
    // rather than stretching beside a long table.
    //
    // Sticky only from lg, where the rail exists at all. `top-6` rather than a navbar-sized
    // offset because nothing is pinned up there: the header scrolls away with the page, so
    // this just needs a little air above it. No ancestor sets overflow, which is what would
    // otherwise turn position:sticky into a no-op.
    <TabsList
      aria-label={ariaLabel}
      className="bg-muted/40 h-auto w-full flex-col items-stretch justify-start gap-0.5 self-start rounded-lg border-0 p-2.5 lg:sticky lg:top-6"
    >
      {tabs.map(({ value: tabValue, label, Icon, count }) => (
        <TabsTrigger
          key={tabValue}
          value={tabValue}
          className={RAIL_TRIGGER_CLASS}
          id={`tab-${tabValue}`}
          aria-controls={`panel-${tabValue}`}
          // With a count, spell it into the accessible name; otherwise the visible label
          // already names the tab.
          aria-label={count === undefined ? undefined : `${label}, ${count}`}
        >
          {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
          <span className="truncate">{label}</span>
          {count !== undefined ? (
            // Filled and borderless at rest: the outline made seven quiet counts read as
            // seven controls. Only the active row's count picks up the tint.
            <span className="bg-muted text-muted-foreground group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary dark:group-data-[state=active]:bg-blue-950/40 dark:group-data-[state=active]:text-blue-300 ml-auto min-w-5 rounded-full border-0 px-1.5 text-center text-xs leading-5 font-medium">
              {count}
            </span>
          ) : null}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/** The course page's tab strip: {@link TabBar} preloaded with COURSE_TABS + counts. */
export function CourseTabBar({
  counts,
  value,
  onValueChange,
  rail = false,
}: {
  counts?: TabCounts;
  value: string;
  onValueChange: (value: string) => void;
  /** Render the vertical rail instead of the strip. Set by the caller from viewport
   *  width, because only one tablist may be in the DOM at a time: both emit `tab-*`
   *  ids that CourseTabPanel points `aria-labelledby` at. */
  rail?: boolean;
}) {
  const tabs = COURSE_TABS.map((t) => ({
    value: t.value,
    label: t.label,
    Icon: t.Icon,
    count: counts?.[t.value],
  }));

  if (rail) {
    return <CourseTabRail tabs={tabs} ariaLabel="Course content sections" />;
  }

  return (
    <TabBar
      ariaLabel="Course content sections"
      selectId="course-tab-select"
      value={value}
      onValueChange={onValueChange}
      linkPanels
      tabs={tabs}
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
