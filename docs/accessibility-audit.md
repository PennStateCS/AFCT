# Accessibility audit

**Date:** July 11, 2026
**Scope:** the full dashboard frontend: app shell and auth, the shared component
library, admin surfaces, and course/student surfaces.
**Method:** static code review against a WCAG 2.1 AA checklist, four parallel
passes with every finding verified against an exact file and line. No live
screen-reader session or pixel-level contrast measurement was performed, so
contrast notes marked "verify" should be confirmed with a tool against rendered
pixels before treating them as failures.

## Executive summary

The codebase is in better shape than most: landmarks, labeled icon buttons,
`aria-sort` on table headers, text labels alongside every colored status badge,
and sr-only page headings are used consistently. Nothing found here blocks a
core task outright for a keyboard user. That said, the audit surfaced six
recurring themes, roughly in priority order:

1. **Keyboard users cannot see focus on auth fields.** The shared `InputGroup`
   cancels the input focus ring, which hits login, signup, and password change.
   One line to fix, and the single highest-value change in this report.
2. **Escape is disabled for every dialog in the app.** The base `DialogContent`
   force-prevents Escape and outside-click globally. Today the X button saves
   it from being a hard trap, but it strips a standard affordance everywhere
   and becomes a real trap the first time someone hides the close button.
3. **Dynamic changes are silent.** Form errors, table result counts, page
   changes, upload errors, and posted comments all update visually without an
   `aria-live` announcement. The wiring (`aria-describedby`, `aria-invalid`) is
   already correct; what is missing is almost always a `role="alert"` or
   `aria-live` attribute.
4. **Two custom widgets need real work.** The cytoscape automaton viewer has no
   text alternative at all (a blind student gets nothing about the machine),
   and the calendar's hand-rolled day cell breaks react-day-picker's roving
   tab index and arrow-key model while advertising keyboard nav it does not
   deliver.
5. **No reduced-motion handling anywhere.** framer-motion transitions and all
   CSS keyframe animations run unconditionally; a single global
   `prefers-reduced-motion` block covers most of it.
6. **A few real contrast bugs.** Hardcoded `text-slate-900` renders near-black
   on the dark-mode card surface in the feedback views, and the white-on-amber
   draft chips on the calendar sit below 4.5:1.

## Findings

Severity: **serious** = materially impairs use for some users; **moderate** =
meaningful friction or missing announcement; **minor** = polish. Effort:
trivial (< 15 min), small (< 1 hr), medium (a focused session).

> **Status (July 11, 2026):** Fixed on the `a11y-fixes` branch: S1 (input focus
> ring), S2 (Escape closes every dialog while outside-click stays blocked),
> S4 (calendar roving tabindex + arrow keys), and the announcement gaps M1, M2,
> M3, M15. S3 (automaton text alternative), S5/S6 (contrast), and S7-S9 plus the
> remaining moderate/minor items are still open. The automaton viewer (S3) was
> scoped out for now as faculty-only.

### Serious

| # | Location | Issue | WCAG | Fix | Effort |
|---|---|---|---|---|---|
| S1 | `src/components/ui/InputGroup.tsx:161` | `focus-visible:ring-0` cancels the base input focus ring; login/signup/password fields show no visible keyboard focus | 2.4.7 | Delete the override so the base `ring-[3px]` shows | trivial |
| S2 | `src/components/ui/dialog.tsx:60-67` | Base `DialogContent` force-prevents Escape and outside-click for every dialog app-wide; hard trap if a consumer hides the close button | 2.1.1 / 2.1.2 | Make prevention opt-in per dialog; keep Escape working by default | medium |
| S3 | `src/components/JffViewerDialog.tsx:989-995` | Automaton canvas has no role, label, or text alternative; the parsed states/transitions are never exposed as text | 1.1.1 | Render an sr-only summary (type, states, initial/final, transition list) from the already-parsed data; `role="img"` + label on the container | medium |
| S4 | `src/app/dashboard/calendar/CalendarClient.tsx:288-308` | Custom `DayButton` ignores react-day-picker's roving tabindex and arrow-key props; every day cell is a tab stop (~35-42) and the advertised arrow-key nav does not work | 2.1.1 / 2.4.3 | Spread RDP's day props, honor `modifiers.focused`, keep one tabbable cell | medium |
| S5 | `src/components/dialogs/FeedbackDialog.tsx:36` and `src/components/submissions/feedback.tsx:36` | Hardcoded `text-slate-900` on `bg-card`: near-black on dark surface in dark mode | 1.4.3 | Use `text-card-foreground` | trivial |
| S6 | `src/app/dashboard/calendar/CalendarClient.tsx:338-341`, `src/components/dialogs/DayAssignmentsDialog.tsx:99-103` | White text on `bg-amber-600` draft chips, roughly 2.8-3.4:1 | 1.4.3 | Darken to amber-700/800 or switch to dark text | trivial |
| S7 | `src/app/dashboard/users/user-columns.tsx:210-215` | Every row's menu trigger is named just "Manage"; SR users cannot tell whose menu it is (Courses does this correctly) | 2.4.4 / 4.1.2 | `aria-label={"Manage user " + name}` | trivial |
| S8 | `src/app/dashboard/courses/course-columns.tsx:109-112` | Course name hard-truncated via `substring`; no full name exposed to AT or on hover | 2.4.4 / 1.3.1 | Add `title`/`aria-label` with the full name, or CSS truncation | trivial |
| S9 | `src/components/ui/data-table.tsx:447-461` | Clickable rows are `role="row"` with `tabIndex` and click handlers but no actionable role or name; Space also scrolls the page | 4.1.2 / 2.1.1 | Real button/link in a cell, or `role` + label + Space handling | medium |

### Moderate

| # | Location | Issue | WCAG | Fix | Effort |
|---|---|---|---|---|---|
| M1 | `src/components/ui/InputGroup.tsx:233-237`, `SelectField.tsx:124-128`, `SwitchField.tsx:102-106` | Field errors correctly wired (`aria-describedby`, `aria-invalid`) but never announced when they appear | 4.1.3 | `role="alert"` on the error paragraph | trivial |
| M2 | `src/components/FileUploadInput.tsx:192-197` | Upload validation errors (size limit, TLS cert) in a static `<p>`; silent after drag-drop | 4.1.3 | `role="alert"` on the error | trivial |
| M3 | `src/components/ui/data-table.tsx:514-534` | "Page X of Y" and "{rowCount} total" are not live regions; filter/search/page changes are silent (affects Users, Courses, System Logs) | 4.1.3 | `aria-live="polite"` on the status text | trivial |
| M4 | `src/app/layout.tsx` / `src/app/dashboard/layout.tsx:55-61` | No skip-to-content link; keyboard users traverse sidebar + navbar on every page | 2.4.1 | Visually-hidden-until-focused skip link to `<main>` | small |
| M5 | `src/app/globals.css:284-297,368-440`, `src/app/login/page.tsx:363-370` | No `prefers-reduced-motion` handling anywhere (grep found zero matches) | 2.3.3 | Global reduce block + gate framer-motion | medium |
| M6 | `src/components/Navbar.tsx:193-221`, `src/components/DashboardSidebarMenu.tsx:450-479` | `<button>` nested inside Radix `DropdownMenuItem`: nested interactive controls, split hit target | 4.1.2 | Move `onClick` onto the item, drop the inner button | small |
| M7 | `src/components/ui/SearchableMultiSelect.tsx:92-116` | Trigger says `aria-haspopup="listbox"` but opens a `role="menu"` with checkbox labels; announced structure mismatches reality | 4.1.2 | Align to menu semantics (`menuitemcheckbox`) or build a real combobox | medium |
| M8 | `src/components/dialogs/CreateCourseDialog.tsx:173-180`, `DuplicateCourseDialog.tsx:254-260` | Dialogs render no `DialogDescription`; Radix warns and there is no programmatic description | 1.3.1 / 4.1.2 | Add an sr-only description | trivial |
| M9 | `src/components/dialogs/DuplicateCourseDialog.tsx:420-479` | copyMode radios lack `fieldset`/`legend` or `radiogroup`; group label unassociated | 1.3.1 | Wrap in `fieldset` + `legend` | small |
| M10 | `src/components/ui/loading-spinner.tsx:16-21` | Standalone spinner: no `role="status"`, animation not `aria-hidden` (the in-table loader does it right) | 4.1.3 | Mirror the data-table pattern | trivial |
| M11 | `src/components/ui/InputGroup.tsx:258-264` | Valid/invalid check/X icons are `aria-hidden` with no text equivalent | 1.4.1 / 4.1.3 | sr-only "valid"/"invalid" text | small |
| M12 | `src/components/ui/progress.tsx:8-27` | Progressbar has no accessible name | 1.1.1 / 4.1.2 | Forward an `aria-label` | trivial |
| M13 | `src/app/login/page.tsx:155,193-194` | Server auth failures surfaced only via auto-dismissing toast; may vanish before announcement | 4.1.3 | Also route through the existing assertive live region | small |
| M14 | `src/app/login/page.tsx:312-327` | hCaptcha gate appears without announcement or focus move | 4.1.2 / 3.3.1 | `aria-live` wrapper + focus on mount | small |
| M15 | `src/components/DiscussionPanel.tsx:114-179`, `src/components/assignments/StudentAssignmentView.tsx:120-149` | Posted comment appears with no announcement and no focus management | 4.1.3 | `aria-live="polite"` on the thread or focus the new comment | small |
| M16 | `src/components/ui/card.tsx:31` consumers | Several student-facing `CardTitle`s ("Submit Solution", "Submissions", problem headers) and the 404 title are divs, not headings; others correctly add `role="heading"` | 1.3.1 / 2.4.6 | Add `role="heading" aria-level` (404 page should be an `<h1>`) | small |
| M17 | `src/components/FileUploadInput.tsx:142,186-190` | `aria-describedby` points at a help node that only renders when a hint is passed; dangling IDREF for TLS uploads | 1.3.1 | Compose the IDREF list conditionally | small |
| M18 | `src/components/Navbar.tsx:185-190`, `DashboardSidebarMenu.tsx:442-447` | "User Account" menu item is focusable but does nothing | 4.1.2 | Convert to `DropdownMenuLabel` | trivial |

### Minor

| # | Location | Issue | WCAG | Fix | Effort |
|---|---|---|---|---|---|
| N1 | `src/components/ui/table.tsx:68-79` | `<th>` without `scope="col"` | 1.3.1 | Default the scope | trivial |
| N2 | `src/app/dashboard/submissions/SubmissionsClient.tsx:539` | `colSpan={9}` on an 8-column table | 1.3.1 | `colSpan={8}` | trivial |
| N3 | `src/app/dashboard/system-status/status-ui.tsx:157-168` | Trend badge conveys direction via color + bare glyph | 1.1.1 / 1.4.1 | sr-only "up/down/flat" | small |
| N4 | `src/app/dashboard/system-status/status-ui.tsx:170-214` | Sparkline SVG has no label or `aria-hidden` decision | 1.1.1 | `role="img"` + label, or hide it | trivial |
| N5 | `src/app/dashboard/system-status/SystemStatusClient.tsx:123-133` | Essential info in `title` attributes only | 1.3.1 | Move into visible or sr-only text | small |
| N6 | `src/components/ui/SearchableMultiSelect.tsx:122-128` | Dropdown search input has placeholder only | 3.3.2 | `aria-label` | trivial |
| N7 | `src/components/ui/skeleton.tsx:3-11` | Skeletons traversable by AT during load | 4.1.3 | `aria-hidden` default | trivial |
| N8 | `src/components/modules/DueDateModule.tsx:96-102` | "Due soon" is color + weight only (date text always present, so meaning survives) | 1.4.1 | Optional sr-only "(due soon)" | trivial |
| N9 | `src/components/Navbar.tsx:237-241`, `ThemeToggle.tsx:27-31` | Theme menu gives no programmatic current-selection state | 4.1.2 | `menuitemradio` + checked | small |
| N10 | `src/components/ui/sidebar.tsx:256-270`, `EnhancedSidebarTrigger.tsx:12-16` | Sidebar toggle exposes no expanded/collapsed state | 4.1.2 | `aria-expanded` | trivial |
| N11 | `src/components/session/SessionWatcher.tsx:201-211` | Timeout countdown not announced after the dialog opens; progress bar unlabeled | 4.1.3 | Throttled `aria-live` on the remaining time | small |
| N12 | `src/app/login/page.tsx:411-413` | Sign In hard-disabled on invalid email; no feedback on why | 3.3.1 | Validate on submit instead | small |
| N13 | `src/components/ui/InputGroup.tsx:38-40,64` | `requiredMark` accepted but never rendered; required fields have no visual marker (the `required` attribute is present) | 3.3.2 | Re-enable the asterisk with sr-only "required" | trivial |
| N14 | `src/app/dashboard/calendar/CalendarClient.tsx:180-184` | "Loading assignments" overlay not a status region | 4.1.3 | `role="status"` | trivial |
| N15 | `src/app/dashboard/DashboardClient.tsx:74-90` | Course status color bar is color-only, but the adjacent badge text compensates | 1.4.1 | No action strictly needed; verify badge always present | trivial |

## Low-hanging fruit

These are the trivial and small fixes with real impact, ordered so they can be
burned down in roughly one sitting. Items 1 through 6 are the ones I would not
ship another release without.

1. **Restore the input focus ring** (S1): delete `focus-visible:ring-0` in
   `InputGroup.tsx:161`. One line; fixes keyboard focus visibility on every
   auth field.
2. **Fix the dark-mode feedback text** (S5): `text-slate-900` to
   `text-card-foreground` in two files.
3. **Name the per-row Manage buttons in Users** (S7): copy the pattern already
   used in the Courses table.
4. **Expose full course names** (S8): `title` + `aria-label` on the truncated
   link.
5. **Darken the amber draft chips** (S6): two class changes.
6. **`role="alert"` on error messages** (M1, M2): the field wrappers and
   FileUploadInput; four small edits that make every form error audible.
7. **`aria-live="polite"` on DataTable status** (M3): result counts and page
   position announce themselves on every admin table at once.
8. **sr-only `DialogDescription`s** (M8) for the two wizards; silences the
   Radix warning and gives the dialogs a description.
9. **`scope="col"` in TableHead and the Submissions `colSpan`** (N1, N2).
10. **Skip-to-content link** (M4): one anchor in the dashboard layout.
11. **Spinner and skeleton semantics** (M10, N7): `role="status"` on
    LoadingSpinner, `aria-hidden` on Skeleton.
12. **Progress label** (M12) and **sidebar `aria-expanded`** (N10).
13. **404 page heading** (part of M16): make the title an `h1`.
14. **"User Account" dead menu item** (M18): make it a label.
15. **fieldset/legend around the duplicate copy-mode radios** (M9).

## Larger projects (worth scheduling, not an afternoon)

- **Dialog Escape policy** (S2): decide the app-wide rule (Escape closes
  unless a form is dirty), change the base component to default-allow, and
  audit the handful of dialogs that also prevent it locally (ConfirmDialog,
  DayAssignmentsDialog, the wizards).
- **Calendar keyboard model** (S4 + M5's cousin): wire react-day-picker's
  roving tabindex and arrow keys through the custom day cell, and pull the
  nested links out of the button role (M-level finding in the same file).
- **Automaton text alternative** (S3): the parsed states/transitions are
  already in memory; render them as an sr-only definition list. This is the
  difference between the core pedagogical content being available to a blind
  student or not.
- **Reduced motion** (M5): one global CSS block plus a `useReducedMotion`
  gate on the login framer-motion transitions.
- **SearchableMultiSelect semantics** (M7): align the announced role with the
  actual widget.
- **Clickable DataTable rows** (S9): give row activation a real control.

## What is already good

Worth stating so it stays that way: `html lang` and landmark structure are
correct; login has an assertive sr-only live region and labeled password
toggles with `aria-pressed`; every icon-only action button in the Submissions
table carries an `aria-label`; status and severity badges always pair color
with text (Correct/Incorrect/Pending are never color-only); DataTable sort
headers are real buttons with `aria-sort`; the file input under the custom
drop zone is a genuinely focusable, labeled `<input type="file">` with a click
fallback; the Stepper exposes `aria-current="step"` with per-step labels and
disabled-forward semantics; card titles mostly declare `role="heading"` with
levels; the calendar pairs its `aria-hidden` draft glyph with sr-only "(draft)"
text; and the duplicate wizard gates its destructive action behind an explicit
confirmation checkbox. The team's instincts are clearly good; most of this
report is about making dynamic changes audible and taming two custom widgets.
