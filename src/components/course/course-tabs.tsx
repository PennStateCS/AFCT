'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
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
  // Between Groups and Activity: the tabs before it are the things a course is made of, and
  // the two after it are ways of looking back at what happened.
  { value: 'statistics', label: 'Statistics', Icon: BarChart3 },
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
  // Active tab: the same --tab-active family the vertical rail uses, so the two shapes of
  // the SAME navigation read as one system at every width. It used to fill with the global
  // sidebar's charcoal and a white label, which made a local tab strip look like a piece of
  // the dark app chrome and had nothing in common with the rail beside it. A soft tint, a
  // cobalt label and the underline it already had.
  'data-[state=active]:text-tab-active data-[state=active]:font-semibold',
  'data-[state=active]:bg-tab-active-bg',
  // `group` so the count badge can react to the tab's own active state.
  'group inline-flex h-auto items-center justify-center gap-1.5 whitespace-nowrap',
  'rounded-none border-0 border-b-4 border-transparent bg-transparent px-2 py-3 text-sm font-medium lg:px-1',
  'transition-colors',
  'data-[state=active]:border-tab-active',
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
      {/* Still a native <select>, deliberately: it is the right control on a phone and it
          brings its own keyboard and screen-reader behaviour. Only the surface changed. It
          was bg-background + border-border, which is the PAGE's colour and the structural
          border, so on the slate canvas it read as a piece of the page rather than
          something you operate. Same tokens as Input/Textarea/Select now, including the
          focus treatment. */}
      <select
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="border-input bg-card text-foreground focus-visible:border-ring focus-visible:ring-ring/70 h-11 w-full rounded-md border px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
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
            {/* The same pill the rail draws: quiet at rest, tinted on the active tab. It
                used to be tinted on EVERY tab and switch to bg-background when active,
                which only worked while the active tab was filled with charcoal. Against a
                soft tint that would have been the page colour on the card. */}
            {count !== undefined ? (
              <span className="bg-muted text-muted-foreground group-data-[state=active]:bg-tab-active-bg group-data-[state=active]:text-tab-active ml-0.5 rounded-full px-1.5 py-0.5 text-xs leading-none font-medium">
                {count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </>
  );
}

// The vertical rail (see {@link CourseTabBar}).
//
// One navigation card, not a tray of pills. It used to be a muted panel with 10px of inset
// and seven rounded rows floating inside it, which read as a widget parked beside the page.
// It is now the card surface with full-bleed rows and hairline separators, so it reads as a
// menu. Light in both themes on purpose: the global sidebar is the dark one, and two
// charcoal columns would look like two applications.
const RAIL_TRIGGER_CLASS = [
  // `group` so the count badge can react to the item's own active state.
  // flex-none matters: the base TabsTrigger carries flex-1, and in a COLUMN flex container
  // that makes flex-basis govern the main axis, which is height. h-14 would be ignored and
  // every row would sit at its content height instead.
  // `relative` anchors the active indicator; rounded-none because the shell owns the radius.
  'group relative flex h-14 w-full flex-none items-center gap-3 rounded-none text-sm',
  'whitespace-nowrap',
  // Hairline between rows. The shell's own border closes the bottom, so the last row drops
  // its divider rather than doubling up on it.
  'border-x-0 border-t-0 border-b border-border/60 last:border-b-0',
  // Readable at rest. These were muted, which left seven quiet grey labels looking disabled
  // beside the workspace; the dark value is spelled out because the base trigger mutes it
  // there. Only the ACTIVE row is coloured.
  'text-foreground dark:text-foreground font-medium',
  'hover:bg-muted/50 hover:text-foreground',
  // Active: the whole row tints, rather than a pill inset inside a panel. --tab-active is
  // the token for exactly this: cobalt in light, a lighter blue in dark (cobalt on the
  // dark card is 2.8:1 behind a 10% fill, under the floor). It used to be spelled out here
  // as dark:bg-blue-950/40 + dark:text-blue-300, which is the token's own dark value
  // written out by hand, so the rail and the horizontal tab strip could drift apart.
  'data-[state=active]:bg-tab-active-bg data-[state=active]:text-tab-active',
  'data-[state=active]:shadow-none',
  // The 3px marker at the very left edge of the active row. A pseudo-element so it costs
  // the row no width and cannot shift the icon: the row's own padding stays put whether or
  // not it is active.
  "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
  'data-[state=active]:before:bg-tab-active',
  // The shell clips (overflow-hidden), so a ring drawn outside a full-bleed row would lose
  // its left and right edges. Inset, and at full strength since it is now on the card.
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
  'bg-transparent transition-colors',
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
  'aria-selected:bg-tab-active-bg aria-selected:text-tab-active',
  'aria-selected:before:bg-tab-active',
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
  menuLabel = 'Navigation',
  linkPanels = false,
}: {
  tabs: readonly TabBarTab[];
  ariaLabel: string;
  /**
   * The rail's own visible heading, shown while expanded, e.g. "Course Menu". It also
   * supplies the collapse control's name ("Collapse course menu"), so it should read as a
   * noun phrase. Deliberately a prop and not a constant: the same rail runs the course
   * page and five admin pages, and a hardcoded "Course Menu" would label System Settings
   * wrongly. The fallback is generic for the same reason.
   */
  menuLabel?: string;
  /** Emit explicit `tab-*`/`panel-*` ids. Off for callers that let Radix pair them. */
  linkPanels?: boolean;
}) {
  // null outside a LocalNavLayout: the rail renders exactly as it always did, with no
  // toggle, because collapsing it could not move a column that nothing owns.
  const collapse = useLocalNavCollapse();
  const collapsed = collapse?.collapsed ?? false;

  return (
    // One card. No padding of its own: the rows run edge to edge, which is what makes the
    // active tint and its marker reach the rail's own border instead of stopping short.
    // overflow-hidden is what keeps them inside the radius (and why the rows above use an
    // inset focus ring). self-start so it stays the height of its own list rather than
    // stretching beside a long table.
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
    <div className="bg-card border-border flex w-full flex-col self-start overflow-hidden rounded-lg border p-0 shadow-xs lg:sticky lg:top-6">
      <RailHeader menuLabel={menuLabel} collapsed={collapsed} onToggle={collapse?.toggle} />
      <TabsList
        aria-label={ariaLabel}
        className="h-auto w-full flex-col items-stretch justify-start gap-0 rounded-none border-0 bg-transparent p-0"
      >
        {tabs.map(({ value: tabValue, label, Icon, count }) => {
          const trigger = (
            <TabsTrigger
              key={tabValue}
              value={tabValue}
              className={cn(
                RAIL_TRIGGER_CLASS,
                // justify-start is not redundant: the base TabsTrigger carries justify-center,
                // which is right for a horizontal strip and wrong for a rail. Without it the
                // rows with a count only LOOKED left-aligned, because `ml-auto` on the count
                // shoved the icon and label to the left as a side effect; the four rows with
                // no count sat centred. Alignment has to be stated, not inherited from
                // whether a row happens to carry a badge.
                collapsed
                  ? `justify-center px-0 ${RAIL_TRIGGER_COLLAPSED_ACTIVE_CLASS}`
                  : 'justify-start px-5',
              )}
              {...(linkPanels
                ? { id: `tab-${tabValue}`, 'aria-controls': `panel-${tabValue}` }
                : {})}
              // With a count, spell it into the accessible name; otherwise the label span
              // below names the tab, which is why it stays in the DOM as sr-only when
              // collapsed rather than being dropped.
              aria-label={count === undefined ? undefined : `${label}, ${count}`}
            >
              {Icon ? <Icon className="size-5 shrink-0" aria-hidden="true" /> : null}
              <span className={collapsed ? 'sr-only' : 'min-w-0 truncate'}>{label}</span>
              {count !== undefined && !collapsed ? (
                // Filled and borderless: the outline made seven quiet counts read as seven
                // controls. Only the active row's count picks up the tint. Dropped entirely
                // when collapsed: a pill beside a centred icon at 56px is a smudge, and the
                // count is already in the name and the tooltip.
                <span className="bg-muted text-muted-foreground group-data-[state=active]:bg-tab-active-bg group-data-[state=active]:text-tab-active ml-auto inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border-0 px-1.5 text-xs font-medium">
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
 * The rail's header: its name on the left, the collapse control on the right, in one row
 * above the list. The toggle used to sit alone on a row of its own, which read as an
 * unfinished corner rather than a deliberate header.
 *
 * The same control in both states, so focus stays exactly where it was when it is pressed:
 * only the icon and the name change. Collapsed, the label is not rendered at all (rather
 * than hidden in place), so nothing reserves width in a 56px rail.
 *
 * `onToggle` is absent outside a LocalNavLayout, where there is no column to collapse; the
 * header then renders as the label alone.
 */
function RailHeader({
  menuLabel,
  collapsed,
  onToggle,
}: {
  menuLabel: string;
  collapsed: boolean;
  onToggle?: () => void;
}) {
  // "Collapse course menu" from "Course Menu". One string to keep in step rather than a
  // second prop that could disagree with the visible one.
  const toggleLabel = `${collapsed ? 'Expand' : 'Collapse'} ${menuLabel.toLowerCase()}`;
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div
      className={cn(
        'border-border/60 flex h-12 flex-none items-center border-b',
        collapsed ? 'justify-center' : 'justify-between pr-2 pl-4',
      )}
    >
      {/* Plain text, not a heading: it names the control beside it, and the tablist below
          already carries its own accessible name. Same size as a nav row but bolder, so it
          reads as the menu's title without competing with the page heading. */}
      {collapsed ? null : (
        <span className="text-foreground truncate text-sm font-semibold">{menuLabel}</span>
      )}
      {onToggle ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={toggleLabel}
              aria-expanded={!collapsed}
              onClick={onToggle}
              className="text-muted-foreground hover:text-foreground size-8 shrink-0"
            >
              <Icon className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{toggleLabel}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
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
    return (
      <TabRail tabs={tabs} ariaLabel="Course content sections" menuLabel="Course Menu" linkPanels />
    );
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
