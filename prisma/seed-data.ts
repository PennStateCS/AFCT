import type { ProblemType } from '@prisma/client';
import type { CourseLifecycle } from './seed-utils';

type PersonSeed = {
  id?: string;
  email: string;
  firstName: string;
  lastName: string;
};

type CourseSeed = {
  id?: string;
  title: string;
  code: string;
  regCode: string;
  credits: number;
  isPublished: boolean;
  isArchived: boolean;
  assignTa: boolean;
  // When set, the course's dates are pinned to this lifecycle state (relative to
  // now) instead of the rolling academic term.
  lifecycle?: CourseLifecycle;
  // When set, this faculty member is always rostered on the course as FACULTY.
  facultyEmail?: string;
};

/**
 * A set of student groups in one course, and the group sizes to fill.
 *
 * Sizes are deliberately uneven: a set where every group holds three people hides the
 * arithmetic mistakes, and a course whose groups all match makes a per-member fan-out look
 * right even when it is counting the wrong thing.
 */
type GroupSetSeed = {
  name: string;
  courseIndex: number;
  sizes: number[];
};

type AssignmentSeed = {
  id?: string;
  title: string;
  description: string;
  /** Where in the course's run it falls, 0 = the first day, 1 = the last. */
  dueFraction: number;
  isPublished: boolean;
  courseIndex: number;
  /**
   * Which problems it covers, by title.
   *
   * Problems used to be picked at random, so an assignment called "Flip Flops" could hold a
   * Turing machine and a course could set the same problem twice under different names. An
   * explicit list is what makes a seeded assignment read like something a person set, and it is
   * what lets the submissions step know which kind of file each student should be sending.
   */
  problemTitles: string[];
  /**
   * The group set this is assigned to, by name, or omitted for an individual assignment.
   *
   * Individual versus group is the single fact `groupSetId` carries, so an assignment naming a
   * set here is a group assignment and one that does not is not. Both kinds are seeded because
   * group submission, group grading and the per-member fan-out only exist on one side of that
   * line, and nothing local exercised it.
   */
  groupSet?: string;
  /** Points each problem is worth. Defaults to 20. */
  pointsPerProblem?: number;
  /** Attempts allowed per problem, or -1 for unlimited. Defaults to 5. */
  maxSubmissions?: number;
  /** Whether the autograder runs. Defaults to true. */
  autograder?: boolean;
  /**
   * Assigned to only this many students instead of the whole class.
   *
   * Audience and dates are different things and get confused constantly, so one assignment is
   * narrowed this way (through AssignmentAssignee) and given a date override on top. The seed
   * needs a *separate* assignment for it: narrowing one the class had already submitted to left
   * work in the database from students the assignment was not assigned to, which nothing in the
   * app could have produced.
   */
  targetedStudents?: number;
};

export const facultyData: PersonSeed[] = [
  { email: 'faculty@example.com', firstName: 'Charles', lastName: 'Xavier' },
  { email: 'faculty2@example.com', firstName: 'Bruce', lastName: 'Wayne' },
  { email: 'faculty3@example.com', firstName: 'Clark', lastName: 'Kent' },
];

export const studentData: PersonSeed[] = [
  { email: 'student@example.com', firstName: 'Oliver', lastName: 'Green' },
  { email: 'student1@example.com', firstName: 'Peter', lastName: 'Parker' },
  { email: 'student2@example.com', firstName: 'Tony', lastName: 'Stark' },
  { email: 'student3@example.com', firstName: 'Steve', lastName: 'Rogers' },
  { email: 'student4@example.com', firstName: 'Natasha', lastName: 'Romanoff' },
  { email: 'student5@example.com', firstName: 'Thor', lastName: 'Odinson' },
  { email: 'student6@example.com', firstName: 'Clint', lastName: 'Barton' },
  { email: 'student7@example.com', firstName: 'Wanda', lastName: 'Maximoff' },
  { email: 'student8@example.com', firstName: 'Vision', lastName: 'Android' },
  { email: 'student9@example.com', firstName: 'Sam', lastName: 'Wilson' },
  { email: 'student10@example.com', firstName: 'Bucky', lastName: 'Barnes' },
  { email: 'student11@example.com', firstName: 'Scott', lastName: 'Lang' },
  { email: 'student12@example.com', firstName: 'Hope', lastName: 'Van Dyne' },
  { email: 'student13@example.com', firstName: 'Carol', lastName: 'Danvers' },
  { email: 'student14@example.com', firstName: 'Stephen', lastName: 'Strange' },
  { email: 'student15@example.com', firstName: "T'Challa", lastName: 'Wakanda' },
  { email: 'student16@example.com', firstName: 'Shuri', lastName: 'Wakanda' },
  { email: 'student17@example.com', firstName: 'Kurt', lastName: 'Wagner' },
  { email: 'student18@example.com', firstName: 'Jean', lastName: 'Gray' },
  { email: 'student19@example.com', firstName: 'Logan', lastName: 'Howlett' },
  { email: 'student20@example.com', firstName: 'Ororo', lastName: 'Monroe' },
  { email: 'student21@example.com', firstName: 'Remy', lastName: 'LeBeau' },
  { email: 'student22@example.com', firstName: 'Bruce', lastName: 'Banner' },
  { email: 'student23@example.com', firstName: 'Hank', lastName: 'McCoy' },
  { email: 'student24@example.com', firstName: 'Miles', lastName: 'Morales' },
  { email: 'student25@example.com', firstName: 'Gwen', lastName: 'Stacy' },
];

export const adminData: PersonSeed = {
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'User',
};

export const taData: PersonSeed[] = [
  { email: 'ta@example.com', firstName: 'Diana', lastName: 'Prince' },
  { email: 'ta2@example.com', firstName: 'Hal', lastName: 'Jordan' },
];

export const courseData: CourseSeed[] = [
  {
    title: 'Introduction to Digital Systems',
    code: 'CMPEN 271',
    regCode: 'ABC123',
    credits: 4,
    isPublished: true,
    isArchived: false,
    assignTa: true,
    // Pinned to a course that is running now. On the rolling academic term this one started on
    // whatever day the seed happened to run, so in some months the demo course had not opened
    // yet and every screen reached through it was empty.
    lifecycle: 'current',
  },
  {
    title: 'Introduction to Digital Systems',
    code: 'CMPEN 271',
    regCode: 'DEF456',
    credits: 4,
    isPublished: true,
    isArchived: false,
    assignTa: true,
  },
  {
    title: 'Programming and Computation I: Fundamentals',
    code: 'CMPSC 131',
    regCode: 'VSU053',
    credits: 3,
    isPublished: true,
    isArchived: false,
    assignTa: true,
  },
  {
    title: 'Programming and Computation II: Data Structures',
    code: 'CMPSC 132',
    regCode: 'HDB928',
    credits: 3,
    isPublished: true,
    isArchived: false,
    assignTa: false,
  },
  {
    title: 'Introduction to the Theory of Computation',
    code: 'CMPSC 464',
    regCode: 'WME129',
    credits: 3,
    isPublished: true,
    isArchived: false,
    assignTa: false,
    // The one course that sets every problem type AFCT grades, so it has to be running: on the
    // rolling term it landed in a future semester and carried no submissions at all, which left
    // the grammar, regular-expression, pushdown and Turing paths unseeded no matter what.
    lifecycle: 'current',
  },
  // Charles Xavier's lifecycle set: one course in each state so the dev DB can
  // always exercise past / current / future / archived. Dates are pinned relative
  // to now (see getLifecycleDates), not the rolling term.
  {
    title: 'Digital Logic Design',
    code: 'CMPEN 270',
    regCode: 'PAST01',
    credits: 3,
    isPublished: true,
    isArchived: false,
    assignTa: true,
    lifecycle: 'past',
    facultyEmail: 'faculty@example.com',
  },
  {
    title: 'Computer Organization and Design',
    code: 'CMPEN 331',
    regCode: 'CURR01',
    credits: 3,
    isPublished: true,
    isArchived: false,
    assignTa: true,
    lifecycle: 'current',
    facultyEmail: 'faculty@example.com',
  },
  {
    title: 'Operating Systems Design',
    code: 'CMPSC 473',
    regCode: 'FUTR01',
    credits: 3,
    isPublished: true,
    isArchived: false,
    assignTa: false,
    lifecycle: 'future',
    facultyEmail: 'faculty@example.com',
  },
  {
    title: 'Compiler Construction',
    code: 'CMPSC 470',
    regCode: 'ARCH01',
    credits: 3,
    isPublished: true,
    isArchived: true,
    assignTa: false,
    lifecycle: 'archived',
    facultyEmail: 'faculty@example.com',
  },
];

export const problemData = [
  {
    title: 'D Flip-Flop',
    description:
      'Design the finite automation machine involving a D flip-flop with "q0" being the initial state.',
    fileName: '1764689813955-d_flip-flop.jff',
    originalFileName: 'd_flip-flop.jff',
    type: 'FA' as ProblemType,
    maxStates: 2,
    isDeterministic: true,
    courseIndex: 0,
  },
  {
    title: 'Toggle Flip-Flop',
    description:
      'Design the finite automation machine involving a toggle flip-flop with "q0" being the initial state.',
    fileName: '1764689796246-toggle_flip-flop.jff',
    originalFileName: 'toggle_flip-flop.jff',
    type: 'FA' as ProblemType,
    maxStates: 2,
    isDeterministic: true,
    courseIndex: 0,
  },
  {
    title: 'Traffic Light',
    description:
      'Design a traffic light with the states "Green", "Yellow", and "Red" with the "Green" State being the initial state and a high signal causing a change in the light.',
    fileName: '1764689765806-traffic_light.jff',
    originalFileName: 'traffic_light.jff',
    type: 'FA' as ProblemType,
    maxStates: 3,
    isDeterministic: false,
    courseIndex: 0,
  },
  {
    title: 'Three Consecutive 1s',
    description:
      'With "q0" being the initial state, create the finite automation with mininum number of states required to detect three consecutive ones.',
    fileName: '1764689806055-three_consecutive.jff',
    originalFileName: 'three_consecutive.jff',
    type: 'FA' as ProblemType,
    maxStates: 4,
    isDeterministic: true,
    courseIndex: 0,
  },
  {
    title: 'D Flip-Flop',
    description:
      'Design the finite automation machine involving a D flip-flop with "q0" being the initial state.',
    fileName: '1764689813955-d_flip-flop.jff',
    originalFileName: 'd_flip-flop.jff',
    type: 'FA' as ProblemType,
    maxStates: 2,
    isDeterministic: true,
    courseIndex: 1,
  },
  {
    title: 'Toggle Flip-Flop',
    description:
      'Design the finite automation machine involving a toggle flip-flop with "q0" being the initial state.',
    fileName: '1764689796246-toggle_flip-flop.jff',
    originalFileName: 'toggle_flip-flop.jff',
    type: 'FA' as ProblemType,
    maxStates: 2,
    isDeterministic: true,
    courseIndex: 1,
  },
  {
    title: 'Traffic Light',
    description:
      'Design a traffic light with the states "Green", "Yellow", and "Red" with the "Green" State being the initial state and a high signal causing a change in the light.',
    fileName: '1764689765806-traffic_light.jff',
    originalFileName: 'traffic_light.jff',
    type: 'FA' as ProblemType,
    maxStates: 3,
    isDeterministic: false,
    courseIndex: 1,
  },
  {
    title: 'Three Consecutive 1s',
    description:
      'With "q0" being the initial state, create the finite automation with mininum number of states required to detect three consecutive ones.',
    fileName: '1764689806055-three_consecutive.jff',
    originalFileName: 'three_consecutive.jff',
    type: 'FA' as ProblemType,
    maxStates: 4,
    isDeterministic: true,
    courseIndex: 1,
  },
  {
    title: 'CFG Test',
    description: 'Create the context-free grammar with productions S -> a and A -> b.',
    fileName: 'cfg.jff',
    originalFileName: 'cfg.jff',
    type: 'CFG' as ProblemType,
    courseIndex: 4,
  },
  {
    title: 'PDA Test',
    description:
      'Create the pushdown automaton shown in the provided JFLAP file, with "q0" as the initial state.',
    fileName: 'pdatest.jff',
    originalFileName: 'pdatest.jff',
    type: 'PDA' as ProblemType,
    maxStates: 2,
    isDeterministic: false,
    courseIndex: 4,
  },
  {
    title: 'Regex Test',
    description: 'Write a regular expression that matches a single digit from 0 to 9.',
    fileName: 'regex.jff',
    originalFileName: 'regex.jff',
    type: 'RE' as ProblemType,
    courseIndex: 4,
  },
  {
    title: 'Busy Beaver 4',
    description: 'Create the 4-state Busy Beaver Turing machine shown in the provided JFLAP file.',
    fileName: 'busyBeaver4.jff',
    originalFileName: 'busyBeaver4.jff',
    type: 'TM' as ProblemType,
    courseIndex: 4,
  },
  {
    title: 'Collatz Binary',
    description: 'Create the binary Collatz Turing machine shown in the provided JFLAP file.',
    fileName: 'collatzBinary.jff',
    originalFileName: 'collatzBinary.jff',
    type: 'TM' as ProblemType,
    courseIndex: 4,
  },
  {
    title: 'Collatz Unary',
    description: 'Create the unary Collatz Turing machine shown in the provided JFLAP file.',
    fileName: 'collatzUnaryTM.jff',
    originalFileName: 'collatzUnaryTM.jff',
    type: 'TM' as ProblemType,
    courseIndex: 4,
  },
  {
    title: 'Infinite Loop TM',
    description:
      'Create the Turing machine shown in the provided JFLAP file that loops on its working alphabet.',
    fileName: 'InfiniteLoopTM.jff',
    originalFileName: 'InfiniteLoopTM.jff',
    type: 'TM' as ProblemType,
    courseIndex: 4,
  },
  {
    title: 'Odd 01 Pairs TM',
    description: 'Create the Turing machine shown in the provided JFLAP file for odd 01 pairs.',
    fileName: 'odd01pairsTM.jff',
    originalFileName: 'odd01pairsTM.jff',
    type: 'TM' as ProblemType,
    courseIndex: 4,
  },
  {
    title: 'To Lowercase TM',
    description:
      'Create the Turing machine shown in the provided JFLAP file that converts input to lowercase.',
    fileName: 'toLowercaseTM.jff',
    originalFileName: 'toLowercaseTM.jff',
    type: 'TM' as ProblemType,
    courseIndex: 4,
  },
];

/**
 * Group sets, and therefore which courses can hold a group assignment.
 *
 * Two courses get one: the introductory course, where a lab pairs up, and the theory course,
 * where a term project runs in teams. Everything else stays individual, which is the ordinary
 * case and needs to stay the majority.
 */
export const groupSetData: GroupSetSeed[] = [
  { name: 'Lab Partners', courseIndex: 0, sizes: [3, 2, 4, 3] },
  { name: 'Project Teams', courseIndex: 4, sizes: [4, 3, 3, 2] },
];

/**
 * Assignments, written the way a course actually sets them.
 *
 * Two things here are deliberate. Each assignment names its problems, so a course reads as a
 * sequence somebody planned rather than a shuffle: flip-flops before real-world machines, and in
 * the theory course the standard progression from finite automata through to Turing machines.
 * And the theory course covers **every problem type AFCT grades** (FA, RE, CFG, PDA, TM), because
 * a developer who has only ever seen seeded finite automata has never seen the grammar and
 * regular-expression paths, which behave differently: they carry no layout, so the similarity
 * report and the evaluator both treat them unlike an automaton.
 */
export const assignmentData: AssignmentSeed[] = [
  // CMPEN 271, both sections. The same two assignments, but grouped in one section and
  // individual in the other, so the difference between them is visible side by side.
  {
    title: 'Flip Flops',
    description:
      'For this assignment, you will be creating finite automation machines for varying types of flip-flops.',
    dueFraction: 0.35,
    isPublished: true,
    courseIndex: 0,
    problemTitles: ['D Flip-Flop', 'Toggle Flip-Flop'],
    pointsPerProblem: 25,
    maxSubmissions: 5,
  },
  {
    title: 'Real Life Examples',
    description:
      'For this assignment, you will be creating finite automation machines solving real world problems.',
    dueFraction: 0.75,
    isPublished: true,
    courseIndex: 0,
    problemTitles: ['Traffic Light', 'Three Consecutive 1s'],
    groupSet: 'Lab Partners',
    pointsPerProblem: 30,
    maxSubmissions: 3,
  },
  {
    title: 'Sequential Circuits',
    description:
      'Build the state machine for a two-bit counter, and show the output for the first eight clock ticks.',
    dueFraction: 0.9,
    // Still a draft, which no student can see. The course view, the gradebook and the student
    // side all treat an unpublished assignment differently, and nothing seeded one. It carries no
    // submissions and no grades for the same reason: there is nothing for a student to submit to.
    isPublished: false,
    courseIndex: 0,
    problemTitles: ['Three Consecutive 1s'],
    pointsPerProblem: 20,
  },
  {
    title: 'Flip Flops',
    description:
      'For this assignment, you will be creating finite automation machines for varying types of flip-flops.',
    dueFraction: 0.35,
    isPublished: true,
    courseIndex: 1,
    problemTitles: ['D Flip-Flop', 'Toggle Flip-Flop'],
    pointsPerProblem: 25,
    maxSubmissions: 5,
  },
  {
    title: 'Real Life Examples',
    description:
      'For this assignment, you will be creating finite automation machines solving real world problems.',
    dueFraction: 0.75,
    isPublished: true,
    courseIndex: 1,
    problemTitles: ['Traffic Light', 'Three Consecutive 1s'],
    pointsPerProblem: 30,
    // Unlimited attempts, so the submission-limit code has a case where there is no cap.
    maxSubmissions: -1,
  },

  // CMPSC 131 and 132 had no assignments at all, which left two of the nine courses empty.
  {
    title: 'Modelling State in Code',
    description:
      'Build the finite automation behind a piece of stateful code, then explain which of your program variables the states correspond to.',
    dueFraction: 0.5,
    isPublished: true,
    courseIndex: 2,
    problemTitles: ['Three Consecutive 1s', 'D Flip-Flop'],
    pointsPerProblem: 20,
    maxSubmissions: 4,
  },
  {
    title: 'Grammars for Data Structures',
    description:
      'Write the context-free grammar describing the bracket sequences your parser accepts, then build the pushdown automaton that recognises them.',
    dueFraction: 0.6,
    isPublished: true,
    courseIndex: 3,
    problemTitles: ['CFG Test', 'PDA Test'],
    pointsPerProblem: 20,
    maxSubmissions: 4,
  },

  // CMPSC 464, the theory course: the one place every problem type AFCT grades is set, in the
  // order a term covers them.
  {
    title: 'Finite Automata',
    description:
      'Construct deterministic finite automata for each of the languages below, using the fewest states you can justify.',
    dueFraction: 0.15,
    isPublished: true,
    courseIndex: 4,
    problemTitles: ['Three Consecutive 1s', 'Traffic Light'],
    pointsPerProblem: 20,
    maxSubmissions: 5,
  },
  {
    title: 'Regular Expressions',
    description:
      'Write a regular expression for each language, and show that it describes the same language as your automaton from the previous assignment.',
    dueFraction: 0.3,
    isPublished: true,
    courseIndex: 4,
    problemTitles: ['Regex Test'],
    pointsPerProblem: 15,
    maxSubmissions: -1,
  },
  {
    title: 'Context-Free Grammars',
    description:
      'Give a context-free grammar for each language, in teams. Include a derivation of one string of length four or more.',
    dueFraction: 0.45,
    isPublished: true,
    courseIndex: 4,
    problemTitles: ['CFG Test'],
    groupSet: 'Project Teams',
    pointsPerProblem: 25,
    maxSubmissions: 4,
  },
  {
    title: 'Pushdown Automata',
    description:
      'Build a pushdown automaton for the language in teams, and describe in a sentence what your stack holds at each point.',
    dueFraction: 0.6,
    isPublished: true,
    courseIndex: 4,
    problemTitles: ['PDA Test'],
    groupSet: 'Project Teams',
    pointsPerProblem: 25,
    maxSubmissions: 4,
  },
  {
    title: 'Turing Machines',
    description:
      'Build each Turing machine, and state the number of steps yours takes on the worst input of length five.',
    dueFraction: 0.8,
    isPublished: true,
    courseIndex: 4,
    problemTitles: ['Busy Beaver 4', 'Collatz Unary', 'To Lowercase TM'],
    pointsPerProblem: 30,
    maxSubmissions: 3,
  },
  {
    title: 'Undecidability',
    description:
      'Reduce the halting problem to each of the questions below, then exhibit a machine that does not halt.',
    dueFraction: 0.95,
    isPublished: true,
    courseIndex: 4,
    problemTitles: ['Infinite Loop TM'],
    pointsPerProblem: 20,
    // Hand-graded: a reduction is an argument, not something the evaluator can check. Students
    // still submit and the grader still records a verdict; what it does not do is set a grade.
    autograder: false,
  },
  {
    title: 'Makeup: Finite Automata',
    description:
      'A second chance at the finite automata assignment, for students who arranged one.',
    dueFraction: 0.5,
    isPublished: true,
    courseIndex: 4,
    problemTitles: ['Three Consecutive 1s'],
    pointsPerProblem: 20,
    maxSubmissions: 3,
    // The one assignment that is not set for the whole class.
    targetedStudents: 3,
  },

  // Lifecycle courses (indices 5-8): a little content so each state isn't empty.
  {
    title: 'Boolean Algebra Basics',
    description: 'Simplify the given Boolean expressions and build their circuits.',
    dueFraction: 0.4,
    isPublished: true,
    courseIndex: 5,
    problemTitles: ['D Flip-Flop', 'Toggle Flip-Flop'],
    pointsPerProblem: 20,
  },
  {
    title: 'Pipelining Lab',
    description: 'Analyze hazards in a 5-stage pipeline and propose forwarding fixes.',
    dueFraction: 0.5,
    isPublished: true,
    courseIndex: 6,
    problemTitles: ['Three Consecutive 1s'],
    pointsPerProblem: 20,
  },
  {
    title: 'Cache Simulation',
    description: 'Implement and measure a set-associative cache simulator.',
    dueFraction: 0.8,
    isPublished: true,
    courseIndex: 6,
    problemTitles: ['Traffic Light', 'D Flip-Flop'],
    pointsPerProblem: 25,
  },
  {
    title: 'Scheduling Project',
    description: 'Compare CPU scheduling algorithms on a shared workload.',
    dueFraction: 0.5,
    isPublished: true,
    courseIndex: 7,
    problemTitles: ['PDA Test'],
    pointsPerProblem: 20,
  },
  {
    title: 'Lexer Assignment',
    description: 'Write a lexer for the course toy language.',
    dueFraction: 0.6,
    isPublished: true,
    courseIndex: 8,
    problemTitles: ['Regex Test', 'CFG Test'],
    pointsPerProblem: 20,
  },
];
