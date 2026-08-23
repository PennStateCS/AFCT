'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  FileText,
  GraduationCap,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Table,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocalNavCollapse } from '@/components/local-nav';
import { cn } from '@/lib/utils';
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

// Each trigger is a content-width item with a transparent bottom border that picks up
// the active colour (and a bolder label) when active, sitting just above the
// bar's own bottom border. The uniform 144px min-width only kicks in at `lg`; below
// that each tab shrinks to its label so more of them fit before the mobile select
// takes over. No negative margin here: it would push the trigger 1px past the scroll
// container and produce a phantom vertical scrollbar.
export const TAB_BAR_TRIGGER_CLASS = [
  'text-muted-foreground hover:text-foreground',
  // Active tab: the sidebar's own charcoal with a white label, and a cobalt underline via
  // --tab-active, which matches the vertical rails. The sidebar token rather than a literal,
  // so the active tab follows the sidebar in both themes instead of drifting from it; white
  // on that charcoal is comfortably past AA.
  'data-[state=active]:text-white data-[state=active]:font-semibold',
  // `group` so the count badge can react to the tab's own active state.
  'group inline-flex h-auto items-center justify-center gap-1.5 whitespace-nowrap',
  'rounded-none border-0 border-b-4 border-transparent bg-transparent px-2 py-3 text-sm font-medium lg:px-1',
  'transition-colors',
  'data-[state=active]:border-tab-active',
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
// sidebar is the dark one, and two charcoal columns would read as two applications. That
// holds when it is collapsed too: it narrows to the sidebar's rhythm but keeps its own
// muted surface, so the hierarchy between global and local navigation survives.
const RAIL_TRIGGER_CLASS = [
  // `group` so the count badge can react to the item's own active state.
  // flex-none matters: the base TabsTrigger carries flex-1, and in a COLUMN flex container
  // that makes flex-basis govern the main axis, which is height. h-10 was being ignored and
  // every row sat at its content height instead.
  'group flex h-10 w-full flex-none items-center gap-2 rounded-md text-sm',
  'whitespace-nowrap',
  'text-muted-foreground hover:bg-accent hover:text-foreground',
  // Active: a soft tint of the primary, not a filled row. The dark pair is spelled out
  // because primary at 10% behind primary text is 2.8:1 on a dark card, under the floor.
  // Unchanged when collapsed: a full cobalt fill would outrank the global sidebar.
  'data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:font-medium',
  'dark:data-[state=active]:bg-blue-950/40 dark:data-[state=active]:text-blue-300',
  'data-[state=active]:shadow-none',
  'border-0 bg-transparent transition-colors',
].join(' ');

// The same active treatment, keyed off aria-selected instead of data-state.
//
// Only used while collapsed, and it is not a style preference: a collapsed row is wrapped
// in a Radix tooltip trigger, and that ALSO writes `data-state` (closed / delayed-open) on
// the element it is given. It lands on top of the tab's own, so every data-[state=active]
// rule above (and the ones the base TabsTrigger carries) silently stops matching and the
// whole rail reads as inactive. aria-selected is set by Tabs and nothing else touches it.
//
// Kept separate rather than replacing the rules above: the expanded rail relies on sharing
// a modifier with the base trigger so tailwind-merge drops the base's active background.
// Change that and the base bg-background comes back and wins on source order.
const RAIL_TRIGGER_COLLAPSED_ACTIVE_CLASS = [
  'aria-selected:bg-primary/10 aria-selected:text-primary aria-selected:font-medium',
  'dark:aria-selected:bg-blue-950/40 dark:aria-selected:text-blue-300',
].join(' ');

/**
 * A vertical tab rail, for wide screens. The counterpart to {@link TabBar}.
 *
 * Still a Radix tablist, not a `<nav>`: the panels are tab panels and behave as such, so
 * converting the semantics for the sake of the shape would be a regression. The Tabs root
 * carries `orientation="vertical"` (set by the caller) so arrow keys run up and down.
 *
 * Render this OR the strip, never both: with `linkPanels` they emit the same `tab-*` ids,
 * and two of each would break the `aria-labelledby` on every panel.
 */
export function TabRail({
  tabs,
  ariaLabel,
  linkPanels = false,
}: {
  tabs: readonly TabBarTab[];
  ariaLabel: string;
  /** Emit explicit `tab-*`/`panel-*` ids. Off for callers that let Radix pair them. */
  linkPanels?: boolean;
}) {
  // null outside a LocalNavLayout: the rail renders exactly as it always did, with no
  // toggle, because collapsing it could not move a column that nothing owns.
  const collapse = useLocalNavCollapse();
  const collapsed = collapse?.collapsed ?? false;

  return (
    // A surface rather than a rule down the page: the divider split the workspace in two
    // instead of grouping the items. self-start so it stays the height of its own list
    // rather than stretching beside a long table.
    //
    // The container is a plain div, not the TabsList: the collapse control is not a tab,
    // and a non-tab child of role="tablist" is a real accessibility problem rather than a
    // cosmetic one. The list is nested inside and keeps the role and the label.
    //
    // Sticky only from lg, where the rail exists at all. `top-6` rather than a navbar-sized
    // offset because nothing is pinned up there: the header scrolls away with the page, so
    // this just needs a little air above it. No ancestor sets overflow, which is what would
    // otherwise turn position:sticky into a no-op.
    //
    // w-full throughout: the width is the grid column's, set by LocalNavLayout, so the rail
    // and the workspace beside it can never disagree about how much room it is taking.
    <div className="bg-muted/40 flex w-full flex-col gap-1 self-start overflow-hidden rounded-lg p-2.5 lg:sticky lg:top-6">
      {collapse ? <RailCollapseToggle collapsed={collapsed} onToggle={collapse.toggle} /> : null}
      <TabsList
        aria-label={ariaLabel}
        className="h-auto w-full flex-col items-stretch justify-start gap-1 border-0 bg-transparent p-0"
      >
        {tabs.map(({ value: tabValue, label, Icon, count }) => {
          const trigger = (
            <TabsTrigger
              key={tabValue}
              value={tabValue}
              className={cn(
                RAIL_TRIGGER_CLASS,
                collapsed ? `justify-center px-0 ${RAIL_TRIGGER_COLLAPSED_ACTIVE_CLASS}` : 'px-2.5',
              )}
              {...(linkPanels
                ? { id: `tab-${tabValue}`, 'aria-controls': `panel-${tabValue}` }
                : {})}
              // With a count, spell it into the accessible name; otherwise the label span
              // below names the tab, which is why it stays in the DOM as sr-only when
              // collapsed rather than being dropped.
              aria-label={count === undefined ? undefined : `${label}, ${count}`}
            >
              {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
              <span className={collapsed ? 'sr-only' : 'truncate'}>{label}</span>
              {count !== undefined && !collapsed ? (
                // Filled and borderless at rest: the outline made seven quiet counts read
                // as seven controls. Only the active row's count picks up the tint. Dropped
                // entirely when collapsed: a pill beside a centred icon at 36px is a
                // smudge, and the count is already in the name and the tooltip.
                <span className="bg-muted text-muted-foreground group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary ml-auto min-w-5 rounded-full border-0 px-1.5 text-center text-xs leading-5 font-medium dark:group-data-[state=active]:bg-blue-950/40 dark:group-data-[state=active]:text-blue-300">
                  {count}
                </span>
              ) : null}
            </TabsTrigger>
          );

          // Tooltips only while collapsed, where the label is the missing information.
          // Radix opens them on focus as well as hover, so this is not a mouse-only path.
          if (!collapsed) return trigger;
          return (
            <Tooltip key={tabValue}>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent side="right">
                {count === undefined ? label : `${label} (${count})`}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </TabsList>
    </div>
  );
}

/**
 * The rail's own collapse control. One button in both states, so focus stays exactly where
 * it was when it is pressed: only the icon and the name change.
 */
function RailCollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? 'Expand local navigation' : 'Collapse local navigation';
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-expanded={!collapsed}
          onClick={onToggle}
          // Right-aligned when expanded so it sits out of the way of the labels below it,
          // centred when collapsed because there is nowhere else for it to be.
          className={cn(
            'text-muted-foreground hover:text-foreground size-8 shrink-0',
            collapsed ? 'self-center' : 'self-end',
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
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
    return <TabRail tabs={tabs} ariaLabel="Course content sections" linkPanels />;
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
