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
  },
  // Charles Xavier's lifecycle set — one course in each state so the dev DB can
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

export const assignmentData = [
  {
    title: 'Flip Flops',
    description:
      'For this assignment, you will be creating finite automation machines for varying types of flip-flops.',
    dueFraction: 0.35,
    isPublished: true,
    courseIndex: 0,
  },
  {
    title: 'Real Life Examples',
    description:
      'For this assignment, you will be creating finite automation machines solving real world problems.',
    dueFraction: 0.75,
    isPublished: true,
    courseIndex: 0,
  },
  {
    title: 'Flip Flops',
    description:
      'For this assignment, you will be creating finite automation machines for varying types of flip-flops.',
    dueFraction: 0.35,
    isPublished: true,
    courseIndex: 1,
  },
  {
    title: 'Real Life Examples',
    description:
      'For this assignment, you will be creating finite automation machines solving real world problems.',
    dueFraction: 0.75,
    isPublished: true,
    courseIndex: 1,
  },
  // Lifecycle courses (indices 5–8): a little content so each state isn't empty.
  {
    title: 'Boolean Algebra Basics',
    description: 'Simplify the given Boolean expressions and build their circuits.',
    dueFraction: 0.4,
    isPublished: true,
    courseIndex: 5,
  },
  {
    title: 'Pipelining Lab',
    description: 'Analyze hazards in a 5-stage pipeline and propose forwarding fixes.',
    dueFraction: 0.5,
    isPublished: true,
    courseIndex: 6,
  },
  {
    title: 'Cache Simulation',
    description: 'Implement and measure a set-associative cache simulator.',
    dueFraction: 0.8,
    isPublished: true,
    courseIndex: 6,
  },
  {
    title: 'Scheduling Project',
    description: 'Compare CPU scheduling algorithms on a shared workload.',
    dueFraction: 0.5,
    isPublished: true,
    courseIndex: 7,
  },
  {
    title: 'Lexer Assignment',
    description: 'Write a lexer for the course toy language.',
    dueFraction: 0.6,
    isPublished: true,
    courseIndex: 8,
  },
];
