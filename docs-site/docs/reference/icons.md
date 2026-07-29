# Icons

AFCT uses [Lucide](https://lucide.dev/icons/) for every icon in the app. This page covers
`src/lib/icons.ts`, the central palette for the app's main areas, and when to reach for it
instead of importing straight from `lucide-react`.

## `src/lib/icons.ts`

The file re-exports one Lucide icon per domain area under a semantic name:

```ts
export {
  Book as CourseIcon,
  BookOpen as AssignmentIcon,
  FileText as ProblemIcon,
  Upload as SubmissionIcon,
  Table as GradesIcon,
  GraduationCap as RosterIcon,
  UsersRound as GroupsIcon,
  Activity as ActivityIcon,
  Settings as SettingsIcon,
  ShieldCheck as AdminIcon,
  Logs as SystemLogsIcon,
  Gauge as SystemStatusIcon,
  Users as UserAccountsIcon,
} from 'lucide-react';
```

Import from `@/lib/icons` whenever you're rendering the identity of one of these areas: a
page header, a sidebar or tab-strip entry, an empty-state icon, or a menu item that opens
that area. Doing this everywhere means a course (for example) always renders as the same
`Book` glyph, whether it's in the sidebar, an empty-state illustration, or a dropdown menu
item, so the reader recognizes the concept at a glance instead of re-parsing a new icon
each time.

```tsx
// Avoid: a fresh, ungrounded choice of icon for "this is a course"
import { BookOpen } from 'lucide-react';

// Prefer: the same icon every other course reference uses
import { CourseIcon } from '@/lib/icons';
```

## What stays out of the central file

`icons.ts` is for icons that **identify an area**, not for generic actions. Keep importing
these directly from `lucide-react` at their call site:

- Row and menu actions: `Trash2`, `Pencil`, `Copy`, `Plus`, `Download`, `Eye`, and similar.
- One-off icons tied to a single, narrow feature rather than one of the app's main areas
  (`Calendar` for the Calendar link, `Wrench` for Development Tests, `Library` for Archived
  Courses).

Centralizing those too would bury the icons that actually carry meaning under a pile of
UI chrome, and defeat the point of having a short, readable list.

## Picking an icon for a new area

1. Check whether the concept already has an icon in `src/lib/icons.ts`. Most new UI is a
   new view onto an existing area (another Courses list, another Assignments empty state),
   not a new area.
2. If it's genuinely new, browse [lucide.dev/icons](https://lucide.dev/icons/) for a glyph
   that reads clearly at 16-24px, and check it isn't already doing double duty for a
   different concept elsewhere in `icons.ts` (the file's inline comments note the
   deliberate splits, e.g. `ActivityIcon` for a course's audit trail vs. `SystemStatusIcon`
   for server health, which look related but aren't the same thing).
3. Add it to `icons.ts` with a short comment explaining what it represents, and import it
   from there everywhere that area's identity is rendered.

## Keeping a tab strip and its panel in sync

`src/components/course/course-tabs.tsx` is the single source of truth for the course page's
tab bar. Its `COURSE_TABS` array points at `@/lib/icons`, and each tab's panel heading
(`AssignmentsCard`, `ProblemsCard`, `RosterCard`, `GradesCard`, `GroupSetsCard`,
`ActivityCard`, course settings) imports the same icon for its own heading. If you add a
new tab, import its icon from `@/lib/icons` in both places rather than picking one
independently for the panel.
