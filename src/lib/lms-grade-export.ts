export type LmsPlatform = 'canvas' | 'blackboard' | 'moodle' | 'generic';

export type LmsAssignment = {
  id: string;
  title: string;
};

export type LmsStudentRow = {
  id: string;
  name?: string;
  email?: string | null;
  firstName?: string;
  lastName?: string;
  [key: string]: unknown;
};

const escapeCsvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

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
    moodle: ['Email address', 'First name', 'Surname', 'ID number', ...assignmentHeaders],
    generic: ['Student Name', 'Email', ...assignmentHeaders],
  };

  const rows = students.map((student) => {
    const { firstName, lastName } = resolveNameParts(student);
    const email = String(student.email ?? '');
    const gradeCells = getAssignmentGrades(student, assignments);

    if (platform === 'canvas') {
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

    if (platform === 'moodle') {
      return [email, firstName, lastName, student.id, ...gradeCells];
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
