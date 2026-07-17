import { describe, expect, it } from 'vitest';
import {
  buildLmsGradesCsv,
  findCanvasReservedTitleConflicts,
  type LmsAssignment,
  type LmsStudentRow,
} from './lms-grade-export';

describe('buildLmsGradesCsv', () => {
  const assignments: LmsAssignment[] = [
    { id: 'a1', title: 'Homework 1' },
    { id: 'a2', title: 'Quiz 1' },
  ];

  const students: LmsStudentRow[] = [
    {
      id: 's1',
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      a1: 95,
      a2: 88,
    },
  ];

  it('builds Canvas CSV with expected leading columns', () => {
    const { csvContent, filenamePrefix } = buildLmsGradesCsv('canvas', students, assignments);

    expect(filenamePrefix).toBe('grades-canvas');
    expect(csvContent).toContain('"Student","ID","SIS User ID","SIS Login ID","Section"');
    expect(csvContent).toContain('"Lovelace, Ada","","","ada@example.com",""');
  });

  it('builds Blackboard CSV with username and availability columns', () => {
    const { csvContent, filenamePrefix } = buildLmsGradesCsv('blackboard', students, assignments);

    expect(filenamePrefix).toBe('grades-blackboard');
    expect(csvContent).toContain('"Username","First Name","Last Name","Student ID","Availability"');
    expect(csvContent).toContain('"ada@example.com","Ada","Lovelace","s1","Y"');
  });

  it('builds Generic CSV with student name and email', () => {
    const { csvContent, filenamePrefix } = buildLmsGradesCsv('generic', students, assignments);

    expect(filenamePrefix).toBe('grades-generic');
    expect(csvContent).toContain('"Student Name","Email","Homework 1","Quiz 1"');
    expect(csvContent).toContain('"Ada Lovelace","ada@example.com","95","88"');
  });

  it('exports blank cells when a grade is missing', () => {
    const studentsWithMissingGrade: LmsStudentRow[] = [
      {
        id: 's2',
        name: 'Alan Turing',
        firstName: 'Alan',
        lastName: 'Turing',
        email: 'alan@example.com',
        a1: 100,
        a2: null,
      },
    ];

    const { csvContent } = buildLmsGradesCsv('canvas', studentsWithMissingGrade, assignments);
    expect(csvContent).toContain('"Turing, Alan","","","alan@example.com","","100",""');
  });

  it('neutralizes spreadsheet formula injection in text cells but leaves numbers intact', () => {
    const evilStudents: LmsStudentRow[] = [
      {
        id: 's3',
        name: '=HYPERLINK("http://evil.example","click")',
        email: 'x@example.com',
        a1: '-5', // a legitimately negative grade
        a2: '=1+1',
      },
    ];

    const { csvContent } = buildLmsGradesCsv('generic', evilStudents, assignments);

    // The name and the formula-like grade get an apostrophe prefix so a spreadsheet
    // renders them as text rather than executing them.
    expect(csvContent).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(csvContent).toContain(`"'=1+1"`);
    // A plain negative number is data, not a formula — left untouched.
    expect(csvContent).toContain('"-5"');
  });
});

describe('findCanvasReservedTitleConflicts', () => {
  it('flags titles containing a reserved phrase (case-insensitive substring)', () => {
    expect(
      findCanvasReservedTitleConflicts(['Final Grade Reflection', 'current score check']),
    ).toEqual(['Final Grade Reflection', 'current score check']);
  });

  it('flags titles that exactly match a reserved column name', () => {
    expect(findCanvasReservedTitleConflicts(['Section', 'id'])).toEqual(['Section', 'id']);
  });

  it('does not false-positive on reserved column names appearing as substrings', () => {
    // "Bridge" contains "id", "Student Presentation" contains "Student" — neither collides.
    expect(findCanvasReservedTitleConflicts(['Bridge Project', 'Student Presentation'])).toEqual(
      [],
    );
  });

  it('returns an empty array when nothing collides', () => {
    expect(findCanvasReservedTitleConflicts(['Homework 1', 'Quiz 1'])).toEqual([]);
  });
});
