export type LmsPlatform = 'canvas' | 'blackboard' | 'moodle' | 'brightspace' | 'generic';

export type LmsAssignment = {
  id: string;
  title: string;
};

export type LmsStudentRow = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  [key: string]: unknown;
};

// A spreadsheet treats a cell starting with any of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;
// Plain (optionally negative) numbers are safe data, not injection — leave them alone.
const NUMERIC = /^-?\d+(\.\d+)?$/;

const escapeCsvCell = (value: unknown) => {
  let s = String(value ?? '');
  // CSV / formula injection guard: user-controlled text (e.g. a student's name set to
  // `=HYPERLINK(...)`) would run as a formula when the export is opened in Excel/Sheets.
  // Prefix such cells with an apostrophe so they render as literal text. Numbers pass
  // through untouched so grades like "-5" stay numeric.
  if (FORMULA_START.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

const toGradeCell = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
};

const resolveNameParts = (student: LmsStudentRow) => {
  const first = String(student.firstName ?? '').trim();
  const last = String(student.lastName ?? '').trim();

  if (first || last) {
    return { firstName: first, lastName: last };
  }

  const full = String(student.name ?? '').trim();
  const parts = full.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
};

const getAssignmentGrades = (student: LmsStudentRow, assignments: LmsAssignment[]) =>
  assignments.map((a) => toGradeCell(student[a.id]));

export function buildLmsGradesCsv(
  platform: LmsPlatform,
  students: LmsStudentRow[],
  assignments: LmsAssignment[],
): { csvContent: string; filenamePrefix: string } {
  const assignmentHeaders = assignments.map((a) => a.title);

  const brightspaceHeaders = assignmentHeaders.map((a) => a + ' Points Grade');

  const headersByPlatform: Record<LmsPlatform, string[]> = {
    canvas: ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', ...assignmentHeaders],
    blackboard: [
      'Username',
      'First Name',
      'Last Name',
      'Student ID',
      'Availability',
      ...assignmentHeaders,
    ],
    brightspace: [
      'OrgDefinedId',
      'Username',
      'Last Name',
      'First Name',
      ...brightspaceHeaders,
      'End-of-Line Indicator',
    ],
    moodle: ['email', ...assignmentHeaders],
    generic: ['Student Name', 'Email', ...assignmentHeaders],
  };

  const rows = students.map((student) => {
    const { firstName, lastName } = resolveNameParts(student);
    const email = String(student.email ?? '');
    const gradeCells = getAssignmentGrades(student, assignments);

    if (platform === 'canvas') {
      // Columns: Student, ID, SIS User ID, SIS Login ID, Section, ...grades.
      // Canvas matches students on SIS Login ID, which is their login/email.
      return [
        `${lastName}, ${firstName}`.trim().replace(/^,\s*/, ''),
        '',
        '',
        email,
        '',
        ...gradeCells,
      ];
    }

    if (platform === 'blackboard') {
      return [email, firstName, lastName, student.id, 'Y', ...gradeCells];
    }

    if (platform === 'brightspace') {
      return ['', '', lastName, firstName, ...gradeCells, '#'];
    }

    if (platform === 'moodle') {
      return [email, ...gradeCells];
    }

    return [student.name ?? `${firstName} ${lastName}`.trim(), email, ...gradeCells];
  });

  const csvContent = [headersByPlatform[platform], ...rows]
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
    .join('\n');

  return {
    csvContent,
    filenamePrefix: `grades-${platform}`,
  };
}
