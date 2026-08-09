import { describe, it, expect } from 'vitest';

import { describeGradeHold } from './grade-hold';

const describeFor = (over: Partial<Parameters<typeof describeGradeHold>[0]> = {}) =>
  describeGradeHold({
    autograderEnabled: true,
    gradeSource: 'AUTOGRADER',
    gradedManually: false,
    hasGrade: true,
    ...over,
  });

describe('describeGradeHold', () => {
  it('says nothing is graded when there is no grade', () => {
    expect(describeFor({ hasGrade: false }).state).toBe('not-graded');
    expect(describeFor({ hasGrade: false, gradeSource: 'MANUAL' }).state).toBe('not-graded');
  });

  /**
   * The distinction the gradebook got wrong: `autograderEnabled` is how the problem is set
   * up, `gradeSource` is who produced the number. A hand-entered grade on an autograded
   * problem is an override, not an autograded grade.
   */
  it('tells a manual override apart from an autograded grade on the same problem', () => {
    expect(describeFor({ gradeSource: 'MANUAL' }).state).toBe('manual-override');
    expect(describeFor({ gradeSource: 'AUTOGRADER' }).state).toBe('autograded');
  });

  /**
   * And apart from ordinary hand grading, which is the pair the two states are most easily
   * confused for: both were typed by a person, but only one overrode anything.
   */
  it('tells an override apart from hand grading on a manual problem', () => {
    const override = describeFor({ autograderEnabled: true, gradeSource: 'MANUAL' });
    const manual = describeFor({ autograderEnabled: false, gradeSource: 'MANUAL' });

    expect(override.state).toBe('manual-override');
    expect(manual.state).toBe('manually-graded');
    expect(override.label).not.toBe(manual.label);
  });

  it('picks out only the override', () => {
    expect(describeFor({ gradeSource: 'MANUAL' }).emphasis).toBe(true);
    expect(describeFor({ gradeSource: 'AUTOGRADER' }).emphasis).toBe(false);
    expect(describeFor({ autograderEnabled: false, gradeSource: 'MANUAL' }).emphasis).toBe(false);
  });

  // Automatic grading can be switched off after the fact, which leaves an autograder-written
  // grade on a problem that is now hand-graded. Claiming a person entered it would be false.
  it('still credits the autograder for a grade it wrote before being switched off', () => {
    expect(describeFor({ autograderEnabled: false, gradeSource: 'AUTOGRADER' }).state).toBe(
      'autograded',
    );
  });

  /**
   * The hold is not provenance, and reading it as provenance is what produced the wrong
   * message. Grade a group, then release one member: their grade is still the one a person
   * chose, and telling them "the autograder set this grade" is simply false.
   */
  describe('releasing a grade does not rewrite where it came from', () => {
    it('still credits the person who set it', () => {
      const released = describeFor({ gradeSource: 'MANUAL', gradedManually: false });

      expect(released.state).toBe('manual-override');
      expect(released.detail).toMatch(/a person set this grade/i);
      expect(released.detail).not.toMatch(/the autograder set this grade/i);
    });

    it('but does say the autograder can now replace it', () => {
      const released = describeFor({ gradeSource: 'MANUAL', gradedManually: false });
      const held = describeFor({ gradeSource: 'MANUAL', gradedManually: true });

      expect(released.held).toBe(false);
      expect(released.detail).toMatch(/can replace it/i);
      expect(held.held).toBe(true);
      expect(held.detail).toMatch(/will not change it/i);
    });

    // The mirror image, which the new hold action makes reachable: freezing an autograded
    // grade does not make it a person's work.
    it('and holding an autograded grade does not credit a person', () => {
      const heldAuto = describeFor({ gradeSource: 'AUTOGRADER', gradedManually: true });

      expect(heldAuto.state).toBe('autograded');
      expect(heldAuto.held).toBe(true);
      expect(heldAuto.detail).toMatch(/the autograder set this grade/i);
    });
  });

  describe('the action', () => {
    it('offers release, behind a confirmation, for a held grade', () => {
      const { action } = describeFor({ gradeSource: 'MANUAL', gradedManually: true });

      expect(action?.hold).toBe(false);
      expect(action?.confirm).not.toBeNull();
    });

    // Holding a grade cannot change anyone's mark, so interrupting for it would only train
    // people to click through the confirmation that does matter.
    it('offers a hold with no confirmation for a released grade', () => {
      const { action } = describeFor({ gradeSource: 'AUTOGRADER', gradedManually: false });

      expect(action?.hold).toBe(true);
      expect(action?.confirm).toBeNull();
    });

    // A re-run on a hand-graded problem gives feedback and never writes a grade, so there is
    // nothing on the other side of the control.
    it('offers nothing where the autograder would never write the grade', () => {
      expect(describeFor({ autograderEnabled: false, gradeSource: 'MANUAL' }).action).toBeNull();
      expect(
        describeFor({ autograderEnabled: false, gradeSource: 'AUTOGRADER' }).action,
      ).toBeNull();
    });

    // The endpoint refuses to invent a grade to hold, so a control here produced a 404 and
    // a "Failed to update the grade hold" toast.
    it('offers nothing before anything has been graded', () => {
      expect(describeFor({ hasGrade: false }).action).toBeNull();
    });
  });
});
