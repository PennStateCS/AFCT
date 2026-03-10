import { describe, expect, it } from 'vitest';
import { buildLmsGradesCsv, type LmsAssignment, type LmsStudentRow } from './lms-grade-export';

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
});
