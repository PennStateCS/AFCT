import { describe, expect, it } from 'vitest';
import { apiPaths } from './api-paths';

describe('apiPaths', () => {
  it('builds course paths', () => {
    expect(apiPaths.courses()).toBe('/api/courses');
    expect(apiPaths.course('c1')).toBe('/api/courses/c1');
    expect(apiPaths.course('c1', { view: 'summary' })).toBe('/api/courses/c1?view=summary');
    expect(apiPaths.courseEnroll('c1')).toBe('/api/courses/c1/enroll');
    expect(apiPaths.courseRosterEntry('c1', 'u2')).toBe('/api/courses/c1/roster/u2');
  });

  it('omits empty query params', () => {
    expect(apiPaths.course('c1')).toBe('/api/courses/c1');
    expect(apiPaths.myCourses()).toBe('/api/courses/list');
    expect(apiPaths.myCourses({ view: 'nav' })).toBe('/api/courses/list?view=nav');
  });

  it('builds assignment paths', () => {
    expect(apiPaths.assignment('c1', 'a1')).toBe('/api/courses/c1/a1');
    expect(apiPaths.assignment('c1', 'a1', { view: 'full' })).toBe('/api/courses/c1/a1?view=full');
    expect(apiPaths.assignmentProblem('c1', 'a1', 'p1')).toBe('/api/courses/c1/a1/problems/p1');
    expect(apiPaths.assignmentProblemGrade('c1', 'a1', 'p1', 's1')).toBe(
      '/api/courses/c1/a1/problems/p1/grade/s1',
    );
    expect(apiPaths.assignmentsRange('2026-01-01', '2026-02-01')).toBe(
      '/api/assignments/range?start=2026-01-01&end=2026-02-01',
    );
  });

  it('builds problem, submission, and account paths', () => {
    expect(apiPaths.problem('p1')).toBe('/api/problems/p1');
    expect(apiPaths.problemComments('p1')).toBe('/api/problems/p1/comments');
    expect(apiPaths.submissionRerun('s1')).toBe('/api/submissions/s1/rerun');
    expect(apiPaths.profile()).toBe('/api/profile');
    expect(apiPaths.systemSettingsPublic()).toBe('/api/system-settings/public');
  });

  it('builds admin paths', () => {
    expect(apiPaths.admin.users()).toBe('/api/admin/users');
    expect(apiPaths.admin.users({ role: 'FACULTY' })).toBe('/api/admin/users?role=FACULTY');
    expect(apiPaths.admin.status()).toBe('/api/admin/status');
    expect(apiPaths.admin.status({ deep: true })).toBe('/api/admin/status?deep=1');
    expect(apiPaths.admin.logsExportFields()).toBe('/api/admin/logs/export/fields');
  });

  it('supports optional query params on comments and courseJoin', () => {
    expect(apiPaths.comments()).toBe('/api/comments');
    expect(apiPaths.comments({ commentId: 'x1' })).toBe('/api/comments?commentId=x1');
    expect(apiPaths.courseJoin()).toBe('/api/courses/join');
    expect(apiPaths.assignmentByIdProblems('a1')).toBe('/api/assignments/a1/problems');
  });
});
