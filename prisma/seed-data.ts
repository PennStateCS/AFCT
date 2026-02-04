import { ProblemType } from '@prisma/client';

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
];

export const assignmentData = [
  {
    title: 'Flip Flops',
    description:
      'For this assignment, you will be creating finite automation machines for varying types of flip-flops.',
    dueFraction: 0.35,
    maxPoints: 20,
    isPublished: true,
    courseIndex: 0,
  },
  {
    title: 'Real Life Examples',
    description:
      'For this assignment, you will be creating finite automation machines solving real world problems.',
    dueFraction: 0.75,
    maxPoints: 20,
    isPublished: true,
    courseIndex: 0,
  },
  {
    title: 'Flip Flops',
    description:
      'For this assignment, you will be creating finite automation machines for varying types of flip-flops.',
    dueFraction: 0.35,
    maxPoints: 20,
    isPublished: true,
    courseIndex: 1,
  },
  {
    title: 'Real Life Examples',
    description:
      'For this assignment, you will be creating finite automation machines solving real world problems.',
    dueFraction: 0.75,
    maxPoints: 20,
    isPublished: true,
    courseIndex: 1,
  },
];
