# Canvas LMS Integration Guide

## Overview

This document provides comprehensive research and implementation guidance for integrating Canvas LMS with the AFCT Dashboard, focusing on assignments and grades synchronization.

## Table of Contents

1. [Canvas LMS API Overview](#canvas-lms-api-overview)
2. [Authentication](#authentication)
3. [Assignments Integration](#assignments-integration)
4. [Grades Integration](#grades-integration)
5. [Implementation Architecture](#implementation-architecture)
6. [Code Examples](#code-examples)
7. [Security Considerations](#security-considerations)
8. [Setup Instructions](#setup-instructions)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Canvas LMS API Overview

### What is Canvas LMS?

Canvas LMS is a cloud-based learning management system used by educational institutions worldwide. It provides a REST API that allows external applications to interact with courses, assignments, grades, and other educational data.

### API Documentation

- **Official API Documentation**: https://canvas.instructure.com/doc/api/
- **API Version**: Canvas uses a versioned API (currently v1)
- **Base URL Format**: `https://<institution>.instructure.com/api/v1/`

### Key Features

- RESTful architecture
- JSON request/response format
- OAuth 2.0 and API token authentication
- Pagination for large datasets
- Rate limiting (default: 3000 requests per hour per token)
- Webhooks for real-time updates

---

## Authentication

Canvas supports two primary authentication methods:

### 1. OAuth 2.0 (Recommended for Multi-User Applications)

OAuth 2.0 allows users to authorize your application to access their Canvas data without sharing their password.

**Flow:**
1. Register your application in Canvas (Admin → Developer Keys)
2. Redirect users to Canvas authorization URL
3. Receive authorization code
4. Exchange code for access token
5. Use access token for API requests

**OAuth URLs:**
- Authorization: `https://<institution>.instructure.com/login/oauth2/auth`
- Token Exchange: `https://<institution>.instructure.com/login/oauth2/token`

**Required Parameters:**
- `client_id`: Your application's client ID
- `redirect_uri`: Callback URL for your application
- `response_type`: Set to "code"
- `scope`: Requested permissions (e.g., `/api/v1/courses`)

### 2. API Access Tokens (Simpler for Testing/Personal Use)

Users can generate personal access tokens from their Canvas account settings.

**Steps to Generate:**
1. Log into Canvas
2. Account → Settings
3. Scroll to "Approved Integrations"
4. Click "+ New Access Token"
5. Set purpose and expiration
6. Copy the generated token

**Usage:**
Include token in HTTP header:
```
Authorization: Bearer <access_token>
```

---

## Assignments Integration

### Fetching Assignments

#### List Assignments for a Course

**Endpoint:** `GET /api/v1/courses/:course_id/assignments`

**Response Structure:**
```json
{
  "id": 1234,
  "name": "Assignment 1",
  "description": "Complete the following problems...",
  "due_at": "2024-12-31T23:59:59Z",
  "points_possible": 100,
  "grading_type": "points",
  "submission_types": ["online_upload", "online_text_entry"],
  "published": true,
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-15T12:00:00Z"
}
```

**Key Fields:**
- `id`: Unique assignment identifier
- `name`: Assignment title
- `description`: HTML description (may need sanitization)
- `due_at`: ISO 8601 timestamp
- `points_possible`: Maximum points
- `grading_type`: "points", "percent", "letter_grade", "pass_fail", etc.
- `submission_types`: Array of allowed submission methods

#### Get Single Assignment

**Endpoint:** `GET /api/v1/courses/:course_id/assignments/:assignment_id`

**Query Parameters:**
- `include[]`: Additional data (e.g., "submission", "rubric")

### Creating Assignments in Canvas

**Endpoint:** `POST /api/v1/courses/:course_id/assignments`

**Request Body:**
```json
{
  "assignment": {
    "name": "New Assignment",
    "description": "Assignment description",
    "due_at": "2024-12-31T23:59:59Z",
    "points_possible": 100,
    "grading_type": "points",
    "submission_types": ["online_upload"],
    "published": true
  }
}
```

### Updating Assignments

**Endpoint:** `PUT /api/v1/courses/:course_id/assignments/:assignment_id`

**Use Cases:**
- Sync assignment changes from AFCT to Canvas
- Update due dates
- Modify point values

### Syncing Strategy

**Two-Way Sync Options:**

1. **Canvas as Source of Truth:**
   - Periodically fetch assignments from Canvas
   - Update AFCT database with Canvas data
   - Users manage assignments in Canvas

2. **AFCT as Source of Truth:**
   - Create/update assignments in AFCT
   - Push changes to Canvas via API
   - Canvas serves as distribution platform

3. **Bidirectional Sync:**
   - Track last modified timestamps
   - Sync changes in both directions
   - Handle conflicts with manual review

**Recommended: Canvas as Source of Truth**
- Simpler implementation
- Less conflict resolution needed
- Leverages Canvas's robust assignment features

---

## Grades Integration

### Fetching Grades

#### Get Submissions for an Assignment

**Endpoint:** `GET /api/v1/courses/:course_id/assignments/:assignment_id/submissions`

**Response Structure:**
```json
{
  "id": 5678,
  "assignment_id": 1234,
  "user_id": 9876,
  "score": 85,
  "grade": "85",
  "submitted_at": "2024-12-15T18:30:00Z",
  "graded_at": "2024-12-16T10:00:00Z",
  "grader_id": 5432,
  "workflow_state": "graded",
  "late": false,
  "missing": false
}
```

**Key Fields:**
- `score`: Numeric grade (out of points_possible)
- `grade`: String representation (may be letter grade)
- `workflow_state`: "submitted", "graded", "pending_review"
- `late`: Boolean indicating if submitted after due date
- `missing`: Boolean indicating if not submitted

#### Get Student Grades for Course

**Endpoint:** `GET /api/v1/courses/:course_id/students/submissions`

**Query Parameters:**
- `student_ids[]`: Array of student IDs
- `assignment_ids[]`: Array of assignment IDs
- `include[]`: Additional data (e.g., "assignment", "course")

### Posting Grades to Canvas

#### Update Single Submission

**Endpoint:** `PUT /api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id`

**Request Body:**
```json
{
  "submission": {
    "posted_grade": "85"
  },
  "comment": {
    "text_comment": "Great work on this assignment!"
  }
}
```

**Note:** `posted_grade` can be:
- Numeric value (e.g., "85")
- Percentage (e.g., "85%")
- Letter grade (e.g., "B")
- "pass" or "fail" for pass/fail grading

#### Bulk Grade Update

**Endpoint:** `POST /api/v1/courses/:course_id/assignments/:assignment_id/submissions/update_grades`

**Request Body:**
```json
{
  "grade_data": {
    "user_123": {
      "posted_grade": "85"
    },
    "user_456": {
      "posted_grade": "92"
    }
  }
}
```

### Grade Syncing Strategies

**Option 1: Real-Time Sync**
- Post grade to Canvas immediately when entered in AFCT
- Provides instant feedback to students
- Requires reliable API connection

**Option 2: Batch Sync**
- Queue grades in AFCT
- Sync to Canvas on schedule (e.g., daily)
- More resilient to API failures
- Allows review before publishing

**Option 3: Manual Sync**
- Instructor triggers sync when ready
- Maximum control over grade publishing
- Best for high-stakes assessments

---

## Implementation Architecture

### Recommended Architecture for AFCT Dashboard

```
┌─────────────────────────────────────────────────┐
│           AFCT Dashboard (Next.js)              │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌────────────────┐      ┌─────────────────┐  │
│  │  UI Components │      │  API Routes     │  │
│  │  - Assignment  │◄─────┤  /api/canvas/   │  │
│  │    Views       │      │  - sync         │  │
│  │  - Grade       │      │  - assignments  │  │
│  │    Management  │      │  - grades       │  │
│  └────────────────┘      └─────────────────┘  │
│                                ▲               │
│                                │               │
│                          ┌─────┴─────────┐    │
│                          │  Canvas API   │    │
│                          │  Service      │    │
│                          │  Layer        │    │
│                          └───────────────┘    │
│                                ▲               │
└────────────────────────────────┼───────────────┘
                                 │
                                 │ HTTPS
                                 ▼
                    ┌─────────────────────┐
                    │   Canvas LMS API    │
                    │  (External Service) │
                    └─────────────────────┘
```

### Component Breakdown

**1. Canvas API Service Layer (`/src/lib/canvas-api.ts`)**
- Handle authentication
- Make HTTP requests to Canvas
- Parse and transform responses
- Error handling and retry logic
- Rate limiting management

**2. API Routes (`/src/app/api/canvas/`)**
- `/api/canvas/sync` - Trigger sync operations
- `/api/canvas/assignments` - Fetch assignments
- `/api/canvas/grades` - Fetch/post grades
- `/api/canvas/auth` - OAuth flow handling

**3. Database Schema Updates**
- Add Canvas-specific fields to existing models
- Track sync status and timestamps
- Store Canvas IDs for mapping

**4. UI Components**
- Sync status indicators
- Manual sync triggers
- Conflict resolution interfaces
- Mapping configuration screens

---

## Code Examples

### 1. Canvas API Service (`/src/lib/canvas-api.ts`)

```typescript
// Canvas API Service Layer
interface CanvasConfig {
  baseUrl: string;
  accessToken: string;
}

interface CanvasAssignment {
  id: number;
  name: string;
  description: string;
  due_at: string | null;
  points_possible: number;
  published: boolean;
}

interface CanvasSubmission {
  id: number;
  assignment_id: number;
  user_id: number;
  score: number | null;
  grade: string | null;
  submitted_at: string | null;
  graded_at: string | null;
  workflow_state: string;
}

class CanvasAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: any
  ) {
    super(message);
    this.name = 'CanvasAPIError';
  }
}

export class CanvasAPI {
  private baseUrl: string;
  private accessToken: string;
  private rateLimitRemaining: number = 3000;
  private rateLimitReset: Date | null = null;

  constructor(config: CanvasConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.accessToken = config.accessToken;
  }

  /**
   * Make authenticated request to Canvas API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    // Check rate limit
    if (this.rateLimitRemaining <= 10 && this.rateLimitReset) {
      const now = new Date();
      if (now < this.rateLimitReset) {
        const waitTime = this.rateLimitReset.getTime() - now.getTime();
        console.warn(`Rate limit approaching, waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Update rate limit info from headers
    const remaining = response.headers.get('X-Rate-Limit-Remaining');
    if (remaining) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new CanvasAPIError(
        `Canvas API error: ${response.statusText}`,
        response.status,
        errorBody
      );
    }

    return response.json();
  }

  /**
   * Handle paginated responses from Canvas
   */
  private async requestPaginated<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = `${this.baseUrl}${endpoint}`;

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        throw new CanvasAPIError(
          `Canvas API error: ${response.statusText}`,
          response.status
        );
      }

      const data = await response.json();
      results.push(...data);

      // Check for next page in Link header
      const linkHeader = response.headers.get('Link');
      nextUrl = this.parseLinkHeader(linkHeader);
    }

    return results;
  }

  /**
   * Parse Link header for pagination
   */
  private parseLinkHeader(header: string | null): string | null {
    if (!header) return null;

    const links = header.split(',');
    for (const link of links) {
      const [url, rel] = link.split(';').map(s => s.trim());
      if (rel === 'rel="next"') {
        return url.slice(1, -1); // Remove < and >
      }
    }
    return null;
  }

  // ============================================================================
  // COURSES
  // ============================================================================

  /**
   * Get list of courses for the authenticated user
   */
  async getCourses() {
    return this.requestPaginated<any>('/api/v1/courses');
  }

  /**
   * Get a single course by ID
   */
  async getCourse(courseId: string) {
    return this.request<any>(`/api/v1/courses/${courseId}`);
  }

  // ============================================================================
  // ASSIGNMENTS
  // ============================================================================

  /**
   * Get all assignments for a course
   */
  async getAssignments(courseId: string): Promise<CanvasAssignment[]> {
    return this.requestPaginated<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments`
    );
  }

  /**
   * Get a single assignment
   */
  async getAssignment(
    courseId: string,
    assignmentId: string
  ): Promise<CanvasAssignment> {
    return this.request<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}`
    );
  }

  /**
   * Create a new assignment in Canvas
   */
  async createAssignment(
    courseId: string,
    assignment: {
      name: string;
      description?: string;
      due_at?: string;
      points_possible?: number;
      grading_type?: string;
      submission_types?: string[];
      published?: boolean;
    }
  ): Promise<CanvasAssignment> {
    return this.request<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments`,
      {
        method: 'POST',
        body: JSON.stringify({ assignment }),
      }
    );
  }

  /**
   * Update an existing assignment
   */
  async updateAssignment(
    courseId: string,
    assignmentId: string,
    updates: Partial<CanvasAssignment>
  ): Promise<CanvasAssignment> {
    return this.request<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ assignment: updates }),
      }
    );
  }

  // ============================================================================
  // SUBMISSIONS & GRADES
  // ============================================================================

  /**
   * Get all submissions for an assignment
   */
  async getSubmissions(
    courseId: string,
    assignmentId: string
  ): Promise<CanvasSubmission[]> {
    return this.requestPaginated<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`
    );
  }

  /**
   * Get a single submission
   */
  async getSubmission(
    courseId: string,
    assignmentId: string,
    userId: string
  ): Promise<CanvasSubmission> {
    return this.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`
    );
  }

  /**
   * Update a submission (post grade)
   */
  async updateSubmission(
    courseId: string,
    assignmentId: string,
    userId: string,
    grade: string | number,
    comment?: string
  ): Promise<CanvasSubmission> {
    const body: any = {
      submission: {
        posted_grade: grade.toString(),
      },
    };

    if (comment) {
      body.comment = {
        text_comment: comment,
      };
    }

    return this.request<CanvasSubmission>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      }
    );
  }

  /**
   * Bulk update submissions (multiple grades at once)
   */
  async bulkUpdateSubmissions(
    courseId: string,
    assignmentId: string,
    grades: Record<string, string | number>
  ): Promise<any> {
    const gradeData: Record<string, any> = {};
    
    for (const [userId, grade] of Object.entries(grades)) {
      gradeData[userId] = {
        posted_grade: grade.toString(),
      };
    }

    return this.request(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/update_grades`,
      {
        method: 'POST',
        body: JSON.stringify({ grade_data: gradeData }),
      }
    );
  }

  /**
   * Get all student submissions for a course
   */
  async getStudentSubmissions(
    courseId: string,
    studentIds?: string[]
  ): Promise<CanvasSubmission[]> {
    let endpoint = `/api/v1/courses/${courseId}/students/submissions`;
    
    if (studentIds && studentIds.length > 0) {
      const params = studentIds.map(id => `student_ids[]=${id}`).join('&');
      endpoint += `?${params}`;
    }

    return this.requestPaginated<CanvasSubmission>(endpoint);
  }

  // ============================================================================
  // USERS
  // ============================================================================

  /**
   * Get users enrolled in a course
   */
  async getCourseUsers(courseId: string) {
    return this.requestPaginated<any>(
      `/api/v1/courses/${courseId}/users`
    );
  }

  /**
   * Get user profile
   */
  async getUser(userId: string) {
    return this.request<any>(`/api/v1/users/${userId}/profile`);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Initialize Canvas API client from environment variables
 */
export function createCanvasClient(): CanvasAPI {
  const baseUrl = process.env.CANVAS_API_URL;
  const accessToken = process.env.CANVAS_ACCESS_TOKEN;

  if (!baseUrl || !accessToken) {
    throw new Error(
      'Canvas API configuration missing. Set CANVAS_API_URL and CANVAS_ACCESS_TOKEN in environment variables.'
    );
  }

  return new CanvasAPI({ baseUrl, accessToken });
}

/**
 * Convert Canvas assignment to AFCT assignment format
 */
export function canvasToAFCTAssignment(
  canvasAssignment: CanvasAssignment
): {
  title: string;
  description: string | null;
  dueDate: Date;
  maxPoints: number;
  isPublished: boolean;
  canvasId: number;
} {
  return {
    title: canvasAssignment.name,
    description: canvasAssignment.description || null,
    dueDate: canvasAssignment.due_at
      ? new Date(canvasAssignment.due_at)
      : new Date(),
    maxPoints: canvasAssignment.points_possible || 0,
    isPublished: canvasAssignment.published,
    canvasId: canvasAssignment.id,
  };
}

/**
 * Convert AFCT assignment to Canvas format
 */
export function afctToCanvasAssignment(assignment: {
  title: string;
  description: string | null;
  dueDate: Date;
  maxPoints: number;
  isPublished: boolean;
}): {
  name: string;
  description: string;
  due_at: string;
  points_possible: number;
  published: boolean;
} {
  return {
    name: assignment.title,
    description: assignment.description || '',
    due_at: assignment.dueDate.toISOString(),
    points_possible: assignment.maxPoints,
    published: assignment.isPublished,
  };
}
```

### 2. API Route for Assignment Sync (`/src/app/api/canvas/assignments/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createCanvasClient, canvasToAFCTAssignment } from '@/lib/canvas-api';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/canvas/assignments
 * Fetch assignments from Canvas and sync to AFCT database
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const canvasCourseId = searchParams.get('canvasCourseId');
    const afctCourseId = searchParams.get('afctCourseId');

    if (!canvasCourseId || !afctCourseId) {
      return NextResponse.json(
        { error: 'Missing required parameters: canvasCourseId, afctCourseId' },
        { status: 400 }
      );
    }

    // Initialize Canvas API client
    const canvas = createCanvasClient();

    // Fetch assignments from Canvas
    const canvasAssignments = await canvas.getAssignments(canvasCourseId);

    // Sync to database
    const syncedAssignments = [];
    for (const canvasAssignment of canvasAssignments) {
      const afctAssignment = canvasToAFCTAssignment(canvasAssignment);

      // Check if assignment already exists (by Canvas ID)
      const existing = await prisma.assignment.findFirst({
        where: {
          courseId: afctCourseId,
          canvasId: canvasAssignment.id,
        },
      });

      if (existing) {
        // Update existing assignment
        const updated = await prisma.assignment.update({
          where: { id: existing.id },
          data: {
            title: afctAssignment.title,
            description: afctAssignment.description,
            dueDate: afctAssignment.dueDate,
            maxPoints: afctAssignment.maxPoints,
            isPublished: afctAssignment.isPublished,
          },
        });
        syncedAssignments.push({ action: 'updated', assignment: updated });
      } else {
        // Create new assignment
        const created = await prisma.assignment.create({
          data: {
            ...afctAssignment,
            courseId: afctCourseId,
          },
        });
        syncedAssignments.push({ action: 'created', assignment: created });
      }
    }

    return NextResponse.json({
      success: true,
      synced: syncedAssignments.length,
      assignments: syncedAssignments,
    });
  } catch (error: any) {
    console.error('Canvas sync error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync assignments' },
      { status: 500 }
    );
  }
}
```

### 3. API Route for Grade Sync (`/src/app/api/canvas/grades/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createCanvasClient } from '@/lib/canvas-api';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/canvas/grades
 * Push grades from AFCT to Canvas
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'FACULTY')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { canvasCourseId, canvasAssignmentId, afctAssignmentId } = body;

    if (!canvasCourseId || !canvasAssignmentId || !afctAssignmentId) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Initialize Canvas API client
    const canvas = createCanvasClient();

    // Fetch grades from AFCT database
    const grades = await prisma.assignmentGrade.findMany({
      where: {
        assignmentId: afctAssignmentId,
      },
      include: {
        student: true,
      },
    });

    if (grades.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No grades to sync',
        synced: 0,
      });
    }

    // Build grade data for bulk update
    const gradeData: Record<string, number> = {};
    
    for (const grade of grades) {
      // Map AFCT student to Canvas user
      // Note: This requires storing Canvas user IDs in your database
      const canvasUserId = grade.student.canvasId;
      
      if (canvasUserId) {
        gradeData[canvasUserId] = grade.grade;
      }
    }

    // Push grades to Canvas
    await canvas.bulkUpdateSubmissions(
      canvasCourseId,
      canvasAssignmentId,
      gradeData
    );

    return NextResponse.json({
      success: true,
      message: 'Grades synced successfully',
      synced: Object.keys(gradeData).length,
    });
  } catch (error: any) {
    console.error('Grade sync error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync grades' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/canvas/grades
 * Fetch grades from Canvas and sync to AFCT
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const canvasCourseId = searchParams.get('canvasCourseId');
    const canvasAssignmentId = searchParams.get('canvasAssignmentId');
    const afctAssignmentId = searchParams.get('afctAssignmentId');

    if (!canvasCourseId || !canvasAssignmentId || !afctAssignmentId) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Initialize Canvas API client
    const canvas = createCanvasClient();

    // Fetch submissions/grades from Canvas
    const submissions = await canvas.getSubmissions(
      canvasCourseId,
      canvasAssignmentId
    );

    // Sync to database
    const syncedGrades = [];
    for (const submission of submissions) {
      if (submission.score === null) continue; // Skip ungraded submissions

      // Find student by Canvas user ID
      const student = await prisma.user.findFirst({
        where: { canvasId: submission.user_id },
      });

      if (!student) {
        console.warn(`Student not found for Canvas user ${submission.user_id}`);
        continue;
      }

      // Upsert grade
      const grade = await prisma.assignmentGrade.upsert({
        where: {
          assignmentId_studentId: {
            assignmentId: afctAssignmentId,
            studentId: student.id,
          },
        },
        create: {
          assignmentId: afctAssignmentId,
          studentId: student.id,
          grade: submission.score,
        },
        update: {
          grade: submission.score,
        },
      });

      syncedGrades.push(grade);
    }

    return NextResponse.json({
      success: true,
      synced: syncedGrades.length,
      grades: syncedGrades,
    });
  } catch (error: any) {
    console.error('Grade fetch error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch grades' },
      { status: 500 }
    );
  }
}
```

### 4. Database Schema Updates

Add Canvas integration fields to your Prisma schema:

```prisma
model User {
  id        String  @id @default(cuid())
  email     String  @unique
  firstName String?
  lastName  String?
  password  String
  role      Role    @default(STUDENT)
  avatar    String?
  inactive  Boolean @default(false)
  
  // Canvas LMS Integration
  canvasId  Int?    @unique  // Canvas user ID
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  rosterEntries Roster[]
  submissions   Submission[]
  grades        AssignmentGrade[]
  activityLogs  ActivityLog[]
  commentsAbout Comment[] @relation("CommentsAboutStudent")

  @@index([role])
  @@index([inactive])
  @@index([createdAt])
  @@index([canvasId])
}

model Course {
  id          String   @id @default(cuid())
  name        String
  code        String   @unique
  regCode     String?  @unique
  semester    String
  credits     Int
  startDate   DateTime
  endDate     DateTime
  isPublished Boolean  @default(false)
  
  // Canvas LMS Integration
  canvasId    Int?     @unique  // Canvas course ID
  canvasUrl   String?           // Direct link to Canvas course
  lastSyncedAt DateTime?        // Last time data was synced from Canvas
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  roster       Roster[]
  assignments  Assignment[]
  problems     Problem[]
  activityLogs ActivityLog[]

  @@index([isPublished])
  @@index([createdAt])
  @@index([canvasId])
}

model Assignment {
  id          String   @id @default(cuid())
  title       String
  description String?
  dueDate     DateTime
  maxPoints   Float
  isPublished Boolean  @default(false)
  
  // Canvas LMS Integration
  canvasId    Int?     @unique  // Canvas assignment ID
  lastSyncedAt DateTime?        // Last time synced from Canvas
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  course   Course @relation(fields: [courseId], references: [id], onDelete: Restrict)
  courseId String

  problems     AssignmentProblem[]
  comments     Comment[]
  activityLogs ActivityLog[]
  grades       AssignmentGrade[]

  @@index([courseId])
  @@index([isPublished])
  @@index([dueDate])
  @@index([courseId, isPublished])
  @@index([canvasId])
}

model AssignmentGrade {
  id       String @id @default(cuid())
  grade    Float
  feedback String?
  
  // Canvas LMS Integration
  syncedToCanvas Boolean @default(false)  // Track if grade has been pushed to Canvas
  canvasSyncedAt DateTime?               // When grade was last synced to Canvas
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  assignment   Assignment @relation(fields: [assignmentId], references: [id], onDelete: Restrict)
  assignmentId String

  student   User   @relation(fields: [studentId], references: [id], onDelete: Restrict)
  studentId String

  @@unique([assignmentId, studentId])
  @@index([assignmentId])
  @@index([studentId])
  @@index([syncedToCanvas])
}
```

---

## Security Considerations

### 1. API Token Storage

**Best Practices:**
- **Never commit tokens to version control**
- Store tokens in environment variables
- Use encrypted storage for user tokens
- Implement token rotation
- Set appropriate expiration dates

**Example `.env` configuration:**
```env
# Canvas LMS Configuration
CANVAS_API_URL="https://yourschool.instructure.com/api/v1"
CANVAS_ACCESS_TOKEN="your_secret_token_here"

# For OAuth (if implementing)
CANVAS_CLIENT_ID="your_client_id"
CANVAS_CLIENT_SECRET="your_client_secret"
CANVAS_REDIRECT_URI="https://yourdomain.com/api/canvas/oauth/callback"
```

### 2. Rate Limiting

Canvas enforces rate limits:
- Default: 3000 requests per hour per token
- Monitor `X-Rate-Limit-Remaining` header
- Implement exponential backoff
- Cache responses when appropriate

### 3. Data Sanitization

Canvas data may contain:
- HTML in descriptions (potential XSS)
- User-generated content
- External links

**Mitigation:**
- Sanitize HTML before displaying
- Use Content Security Policy (CSP)
- Validate all input data
- Escape user-generated content

### 4. Error Handling

**Don't expose:**
- API tokens in error messages
- Internal system details
- Stack traces to end users

**Do:**
- Log errors securely
- Provide user-friendly messages
- Implement retry logic
- Monitor for suspicious activity

### 5. Permission Scopes

When using OAuth, request only necessary scopes:
- `/api/v1/courses` - Access courses
- `/api/v1/assignments` - Manage assignments
- `/api/v1/submissions` - Access/modify submissions

### 6. HTTPS Only

**Always use HTTPS:**
- Protects tokens in transit
- Prevents man-in-the-middle attacks
- Required by Canvas for OAuth

---

## Setup Instructions

### Step 1: Obtain Canvas API Credentials

#### For Development (Personal Access Token):

1. Log into your Canvas instance
2. Click on "Account" → "Settings"
3. Scroll to "Approved Integrations"
4. Click "+ New Access Token"
5. Set:
   - **Purpose**: "AFCT Dashboard Integration"
   - **Expires**: Choose appropriate date
6. Click "Generate Token"
7. **Copy the token immediately** (you won't see it again)

#### For Production (OAuth):

1. Contact your Canvas administrator
2. Request a Developer Key with:
   - **Key Name**: "AFCT Dashboard"
   - **Redirect URI**: `https://yourdomain.com/api/canvas/oauth/callback`
   - **Scopes**: Select appropriate API scopes
3. Receive Client ID and Client Secret

### Step 2: Configure Environment Variables

Add to your `.env.local` (development) or `.env.production` (production):

```env
# Canvas LMS Integration
CANVAS_API_URL="https://yourschool.instructure.com/api/v1"
CANVAS_ACCESS_TOKEN="your_personal_access_token"

# For OAuth (optional)
CANVAS_CLIENT_ID="your_client_id"
CANVAS_CLIENT_SECRET="your_client_secret"
CANVAS_REDIRECT_URI="http://localhost:3000/api/canvas/oauth/callback"
```

Update `.env.example` to include these fields (without actual values).

### Step 3: Update Database Schema

1. Add Canvas integration fields to `prisma/schema.prisma` (see Database Schema Updates section)
2. Create migration:
   ```bash
   npx prisma migrate dev --name add-canvas-integration
   ```
3. Generate Prisma client:
   ```bash
   npm run db:generate
   ```

### Step 4: Install Dependencies

No additional dependencies required! The implementation uses:
- Native `fetch` API (available in Next.js)
- Existing Prisma setup
- NextAuth for authentication

### Step 5: Implement Canvas API Service

1. Create `/src/lib/canvas-api.ts` with the code from the examples above
2. Test the connection:
   ```bash
   node -e "
   const { CanvasAPI } = require('./src/lib/canvas-api.ts');
   const api = new CanvasAPI({
     baseUrl: 'https://yourschool.instructure.com/api/v1',
     accessToken: 'your_token'
   });
   api.getCourses().then(console.log);
   "
   ```

### Step 6: Create API Routes

1. Create `/src/app/api/canvas/assignments/route.ts`
2. Create `/src/app/api/canvas/grades/route.ts`
3. Test endpoints with tools like Postman or curl

### Step 7: Add UI Components

Create a sync interface for administrators:

```tsx
// /src/components/CanvasSyncButton.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface CanvasSyncButtonProps {
  courseId: string;
  canvasCourseId: string;
}

export function CanvasSyncButton({ courseId, canvasCourseId }: CanvasSyncButtonProps) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const response = await fetch(
        `/api/canvas/assignments?canvasCourseId=${canvasCourseId}&afctCourseId=${courseId}`
      );
      
      if (!response.ok) {
        throw new Error('Sync failed');
      }

      const data = await response.json();
      toast.success(`Synced ${data.synced} assignments from Canvas`);
    } catch (error) {
      toast.error('Failed to sync assignments');
      console.error(error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button onClick={handleSync} disabled={syncing}>
      {syncing ? 'Syncing...' : 'Sync from Canvas'}
    </Button>
  );
}
```

---

## Best Practices

### 1. Sync Strategy

**Recommendation: Canvas as Source of Truth**
- Simplifies implementation
- Reduces conflict potential
- Leverages Canvas's robust features
- Instructors manage in familiar interface

**Implementation:**
- Periodic background sync (e.g., every 6 hours)
- Manual sync trigger for admins
- Webhook support for real-time updates (advanced)

### 2. Mapping Users

**Challenge:** Linking Canvas users to AFCT users

**Solutions:**

**Option A: Email-based matching**
```typescript
async function matchCanvasUser(canvasEmail: string) {
  return await prisma.user.findUnique({
    where: { email: canvasEmail }
  });
}
```

**Option B: Manual mapping interface**
- Admin tool to map Canvas IDs to AFCT users
- Store in database for future reference

**Option C: Import wizard**
- Bulk import students from Canvas
- Create AFCT accounts automatically
- Store Canvas ID during creation

### 3. Error Handling

```typescript
try {
  await canvas.syncAssignments();
} catch (error) {
  if (error instanceof CanvasAPIError) {
    if (error.statusCode === 401) {
      // Token expired or invalid
      await notifyAdmin('Canvas token needs renewal');
    } else if (error.statusCode === 429) {
      // Rate limit exceeded
      await scheduleRetry(60 * 60 * 1000); // Retry in 1 hour
    } else {
      // Other API error
      logError(error);
    }
  }
  throw error;
}
```

### 4. Caching

**What to cache:**
- Course lists (TTL: 1 hour)
- Assignment lists (TTL: 30 minutes)
- Student enrollments (TTL: 1 day)

**What NOT to cache:**
- Grades (always fetch fresh)
- Submission status (real-time data)

**Implementation:**
```typescript
import { cache } from 'react';

export const getCachedAssignments = cache(async (courseId: string) => {
  const canvas = createCanvasClient();
  return await canvas.getAssignments(courseId);
});
```

### 5. Logging and Monitoring

**Log critical events:**
- Sync operations (start, success, failure)
- API errors
- Rate limit warnings
- Data conflicts

**Metrics to track:**
- Sync success rate
- Average sync duration
- API response times
- Number of conflicts resolved

---

## Troubleshooting

### Common Issues

#### 1. "Unauthorized" Error (401)

**Causes:**
- Invalid access token
- Expired token
- Insufficient permissions

**Solutions:**
- Regenerate access token in Canvas
- Check token in environment variables
- Verify scopes/permissions

#### 2. Rate Limit Exceeded (429)

**Causes:**
- Too many requests in short time
- Inefficient API usage

**Solutions:**
- Implement request throttling
- Use bulk endpoints where available
- Cache responses
- Monitor `X-Rate-Limit-Remaining` header

#### 3. Data Mismatch

**Causes:**
- Different data models
- Time zone differences
- Grade calculation differences

**Solutions:**
- Transform data appropriately
- Store original Canvas data for reference
- Document mapping logic
- Validate transformations

#### 4. Missing Students

**Causes:**
- Email mismatch
- Student not in AFCT database
- Enrollment timing

**Solutions:**
- Implement robust user matching
- Log unmapped students
- Provide admin interface to resolve
- Auto-create students (with approval)

#### 5. Slow Sync Operations

**Causes:**
- Large number of assignments/students
- Sequential API calls
- No pagination handling

**Solutions:**
- Implement pagination
- Use parallel requests (within rate limits)
- Background job processing
- Progress indicators for users

### Debug Mode

Enable detailed logging:

```typescript
// In canvas-api.ts
export class CanvasAPI {
  private debug = process.env.CANVAS_DEBUG === 'true';
  
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (this.debug) {
      console.log(`[Canvas API] ${options.method || 'GET'} ${endpoint}`);
    }
    
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    if (this.debug) {
      console.log(`[Canvas API] Response: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
}
```

---

## Additional Resources

### Official Documentation
- [Canvas LMS REST API Documentation](https://canvas.instructure.com/doc/api/)
- [Canvas API Live Documentation](https://canvas.instructure.com/doc/api/live)
- [Canvas OAuth2 Documentation](https://canvas.instructure.com/doc/api/file.oauth.html)

### Tools
- [Canvas API Postman Collection](https://www.postman.com/canvas-lms)
- [API Explorer in Canvas](https://<your-canvas>/doc/api/live)

### Community Resources
- [Canvas LMS Community](https://community.canvaslms.com/)
- [Canvas Developers Group](https://community.canvaslms.com/t5/Developers-Group/gh-p/developers)
- [Canvas GitHub](https://github.com/instructure/canvas-lms)

### Example Projects
- [Canvas API Examples](https://github.com/instructure/canvas-lms/tree/master/app/controllers/api)
- Community integrations and libraries

---

## Conclusion

Integrating Canvas LMS with the AFCT Dashboard provides powerful synchronization capabilities for assignments and grades. The implementation outlined in this document follows industry best practices for:

- **Security**: Secure token storage and API communication
- **Reliability**: Error handling and retry logic
- **Performance**: Pagination and caching strategies
- **Maintainability**: Clean architecture and code organization

**Next Steps:**
1. Set up Canvas API credentials
2. Implement the Canvas API service layer
3. Add database fields for Canvas integration
4. Create sync API routes
5. Build admin UI for sync management
6. Test thoroughly with real Canvas data
7. Deploy and monitor

This integration will streamline course management and reduce manual data entry for instructors while maintaining data consistency across both platforms.
