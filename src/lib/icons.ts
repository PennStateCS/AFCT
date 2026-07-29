// Central icon palette for AFCT.
//
// Import domain icons from here instead of pulling icons directly out of
// 'lucide-react' in individual components. The same concept (a course, an
// assignment, a submission...) should render the same icon everywhere it
// appears: sidebar nav, tab strips, page headers, empty states, and menu
// items. See docs-site/docs/reference/icons.md for the full convention and
// how to add a new one.
//
// This file is for icons that identify one of the app's main areas. Generic
// action icons (Trash2, Pencil, Copy, Plus, Download, ...) stay imported
// directly from 'lucide-react' at their call site; centralizing those too
// would hide, rather than clarify, which icons carry real meaning.

export {
  // A course: the courses list, sidebar course links, and course badges.
  Book as CourseIcon,

  // An assignment: the Assignments tab, assignment cards, assignment rows.
  BookOpen as AssignmentIcon,

  // A problem, within an assignment or the course problem bank.
  FileText as ProblemIcon,

  // A student's submission to a problem.
  Upload as SubmissionIcon,

  // The grades table and grade breakdowns.
  Table as GradesIcon,

  // A course's roster: enrolled students and staff.
  GraduationCap as RosterIcon,

  // Group sets and groups within a course. Kept visually distinct from
  // UserAccountsIcon below, which is the admin-wide list of every user.
  UsersRound as GroupsIcon,

  // A course's activity log. Kept visually distinct from SystemStatusIcon
  // below, which is server/infrastructure health, not an audit trail.
  Activity as ActivityIcon,

  // Settings, at any level: course settings and System Settings.
  Settings as SettingsIcon,

  // The Administration sidebar section and other admin-only affordances.
  ShieldCheck as AdminIcon,

  // System Logs: the raw application log stream.
  Logs as SystemLogsIcon,

  // System Status: server and infrastructure health.
  Gauge as SystemStatusIcon,

  // User Accounts: the admin-wide list of every user in the system.
  Users as UserAccountsIcon,
} from 'lucide-react';
