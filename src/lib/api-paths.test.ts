import { describe, expect, it } from 'vitest';
import { apiPaths } from './api-paths';

describe('apiPaths', () => {
  it('builds course paths', () => {
    expect(apiPaths.courses()).toBe('/api/courses');
    expect(apiPaths.course('c1')).toBe('/api/courses/c1');
    expect(apiPaths.course('c1', { view: 'summary' })).toBe('/api/courses/c1?view=summary');
    expect(apiPaths.courseRoster('c1')).toBe('/api/courses/c1/roster');
    expect(apiPaths.courseRosterBulk('c1')).toBe('/api/courses/c1/roster/bulk');
    expect(apiPaths.courseRosterEntry('c1', 'u2')).toBe('/api/courses/c1/roster/u2');
  });

  it('omits empty query params', () => {
    expect(apiPaths.course('c1')).toBe('/api/courses/c1');
    expect(apiPaths.myCourses()).toBe('/api/me/courses');
    expect(apiPaths.myCourses({ view: 'nav' })).toBe('/api/me/courses?view=nav');
  });

  it('builds the /api/me account cluster', () => {
    expect(apiPaths.me()).toBe('/api/me');
    expect(apiPaths.myPassword()).toBe('/api/me/password');
    expect(apiPaths.myEnrollments()).toBe('/api/me/enrollments');
    expect(apiPaths.myAssignments()).toBe('/api/me/assignments');
    expect(apiPaths.myAssignments('2026-01-01', '2026-02-01')).toBe(
      '/api/me/assignments?start=2026-01-01&end=2026-02-01',
    );
  });

  it('builds assignment paths', () => {
    expect(apiPaths.assignment('c1', 'a1')).toBe('/api/courses/c1/assignments/a1');
    expect(apiPaths.assignment('c1', 'a1', { view: 'full' })).toBe(
      '/api/courses/c1/assignments/a1?view=full',
    );
    expect(apiPaths.assignmentProblem('c1', 'a1', 'p1')).toBe(
      '/api/courses/c1/assignments/a1/problems/p1',
    );
    expect(apiPaths.assignmentProblemGrade('c1', 'a1', 'p1', 's1')).toBe(
      '/api/courses/c1/assignments/a1/problems/p1/grade/s1',
    );
    expect(apiPaths.assignmentGroupProblems('c1', 'a1')).toBe(
      '/api/courses/c1/assignments/a1/group-problems',
    );
  });

  it('builds problem, submission, and account paths', () => {
    expect(apiPaths.courseProblem('c1', 'p1')).toBe('/api/courses/c1/problems/p1');
    expect(apiPaths.comments({ commentId: 'cm1' })).toBe('/api/comments?commentId=cm1');
    expect(apiPaths.submissionRerun('s1')).toBe('/api/submissions/s1/rerun');
    expect(apiPaths.systemSettingsPublic()).toBe('/api/system-settings/public');
  });

  it('builds served-file paths', () => {
    expect(apiPaths.files.pfp('a.png')).toBe('/api/files/pfps/a.png');
    expect(apiPaths.files.submission('s.jff')).toBe('/api/files/submissions/s.jff');
    expect(apiPaths.files.problem('p.jff')).toBe('/api/files/problems/p.jff');
    expect(apiPaths.files.solution('x.jff')).toBe('/api/files/solutions/x.jff');
    expect(apiPaths.files.solution('x.jff', { download: true })).toBe(
      '/api/files/solutions/x.jff?download=1',
    );
  });

  it('builds admin paths', () => {
    expect(apiPaths.admin.users()).toBe('/api/admin/users');
    expect(apiPaths.admin.users({ role: 'FACULTY' })).toBe('/api/admin/users?role=FACULTY');
    expect(apiPaths.admin.statusSummary()).toBe('/api/admin/status/summary');
    expect(apiPaths.admin.statusServer()).toBe('/api/admin/status/server');
    expect(apiPaths.admin.statusDatabase()).toBe('/api/admin/status/database');
    expect(apiPaths.admin.statusDatabase({ deep: true })).toBe('/api/admin/status/database?deep=1');
    expect(apiPaths.admin.statusFiles()).toBe('/api/admin/status/files');
    expect(apiPaths.admin.logsExportFields()).toBe('/api/admin/logs/export/fields');
  });

  it('supports optional query params on comments and courseJoin', () => {
    expect(apiPaths.comments()).toBe('/api/comments');
    expect(apiPaths.comments({ commentId: 'x1' })).toBe('/api/comments?commentId=x1');
    expect(apiPaths.courseJoin()).toBe('/api/courses/join');
    expect(apiPaths.assignmentByIdProblems('a1')).toBe('/api/assignments/a1/problems');
  });
});
