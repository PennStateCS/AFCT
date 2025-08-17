# ActivityLog Enhancement Options

## Current State Analysis

Your current ActivityLog model has these characteristics:
- ✅ Flexible metadata storage (JSON)
- ✅ Basic indexing on userId and timestamp
- ❌ Poor query performance for entity-specific filtering
- ❌ No categorization system
- ❌ Metadata queries require JSON parsing

## Option 1: Normalized Foreign Key Approach (RECOMMENDED)

### Schema Changes
```prisma
model ActivityLog {
  id        String   @id @default(cuid())
  userId    String?
  action    String
  timestamp DateTime @default(now())
  metadata  Json?

  // Normalized foreign keys for fast filtering
  courseId     String?
  assignmentId String?
  problemId    String?
  submissionId String?

  // Additional categorization
  category    String? // SYSTEM, COURSE, ASSIGNMENT, PROBLEM, SUBMISSION, USER
  ipAddress   String?
  userAgent   String?

  // Relations and indexes...
}
```

### Benefits
- 🚀 **Fast entity filtering**: `WHERE courseId = ?` vs `WHERE JSON_EXTRACT(metadata, '$.courseId') = ?`
- 📊 **Efficient aggregations**: Count activities per course, assignment, etc.
- 🔍 **Simple queries**: `WHERE category = 'COURSE' AND action LIKE 'CREATE%'`
- 📈 **Better index utilization**: Composite indexes on (courseId, action), (userId, courseId)
- 🔄 **Backward compatible**: Keep metadata for additional details

### Query Examples
```typescript
// All course activities
const courseActivities = await prisma.activityLog.findMany({
  where: { courseId: 'course123' },
  include: { user: true, course: true }
});

// Assignment publish activities
const publishActivities = await prisma.activityLog.findMany({
  where: { 
    category: 'ASSIGNMENT',
    action: 'UPDATE_ASSIGNMENT',
    metadata: { path: ['updatedFields'], array_contains: ['isPublished'] }
  }
});
```

## Option 2: Separate Activity Tables by Category

### Schema Structure
```prisma
// Base activity log
model ActivityLog {
  id        String @id @default(cuid())
  userId    String?
  action    String
  timestamp DateTime @default(now())
  category  String
  metadata  Json?
}

// Specific activity tables
model CourseActivity {
  id           String @id @default(cuid())
  activityLogId String @unique
  activityLog   ActivityLog @relation(fields: [activityLogId], references: [id])
  courseId      String
  course        Course @relation(fields: [courseId], references: [id])
}

model AssignmentActivity {
  id           String @id @default(cuid())
  activityLogId String @unique
  activityLog   ActivityLog @relation(fields: [activityLogId], references: [id])
  assignmentId  String
  assignment    Assignment @relation(fields: [assignmentId], references: [id])
}
```

### Benefits
- 🎯 **Highly optimized queries** per entity type
- 📦 **Clean separation** of concerns
- 🔧 **Easy maintenance** per activity type

### Drawbacks
- 🔄 **Complex writes** (multiple table inserts)
- 📈 **More schema complexity**
- 🔍 **Cross-category queries** are harder

## Option 3: Hybrid Approach with Activity Categories

### Enhanced Current Model
```prisma
model ActivityLog {
  id        String   @id @default(cuid())
  userId    String?
  action    String
  timestamp DateTime @default(now())
  metadata  Json?

  // Category enum for filtering
  category     ActivityCategory
  entityType   String? // 'Course', 'Assignment', 'Problem', 'Submission'
  entityId     String? // ID of the primary entity
  relatedIds   Json?   // Array of related entity IDs
  
  // Common extracted fields
  ipAddress    String?
  userAgent    String?
  
  @@index([category, timestamp])
  @@index([entityType, entityId])
  @@index([userId, category])
}

enum ActivityCategory {
  SYSTEM      // Login, logout, session extend
  USER        // User CRUD, password changes
  COURSE      // Course CRUD, enrollment
  ASSIGNMENT  // Assignment CRUD, publishing
  PROBLEM     // Problem CRUD
  SUBMISSION  // Submission CRUD, grading
}
```

## Option 4: Event Sourcing Pattern

### Schema Structure
```prisma
model EventLog {
  id            String   @id @default(cuid())
  aggregateType String   // 'Course', 'Assignment', etc.
  aggregateId   String   // ID of the entity
  eventType     String   // 'Created', 'Updated', 'Published'
  eventVersion  Int      // For event versioning
  eventData     Json     // Full event payload
  userId        String?
  timestamp     DateTime @default(now())
  
  @@index([aggregateType, aggregateId, timestamp])
  @@index([eventType, timestamp])
}
```

### Benefits
- 🏗️ **Full audit trail** with event reconstruction
- 📊 **Rich analytics** capabilities
- 🔄 **Event replay** for debugging

### Drawbacks
- 🧠 **Complex implementation**
- 📈 **Higher storage requirements**
- 🔧 **Requires event sourcing expertise**

## Migration Strategy (Option 1 - Recommended)

### Step 1: Add New Columns
```sql
-- Add new columns as nullable first
ALTER TABLE ActivityLog ADD COLUMN courseId TEXT;
ALTER TABLE ActivityLog ADD COLUMN assignmentId TEXT;
ALTER TABLE ActivityLog ADD COLUMN problemId TEXT;
ALTER TABLE ActivityLog ADD COLUMN submissionId TEXT;
ALTER TABLE ActivityLog ADD COLUMN category TEXT;
ALTER TABLE ActivityLog ADD COLUMN ipAddress TEXT;
ALTER TABLE ActivityLog ADD COLUMN userAgent TEXT;
```

### Step 2: Backfill Data
```typescript
// Migration script to extract IDs from metadata
const logs = await prisma.activityLog.findMany();
for (const log of logs) {
  const metadata = log.metadata as any;
  const updates: any = {};
  
  if (metadata?.courseId) updates.courseId = metadata.courseId;
  if (metadata?.assignmentId) updates.assignmentId = metadata.assignmentId;
  if (metadata?.problemId) updates.problemId = metadata.problemId;
  if (metadata?.submissionId) updates.submissionId = metadata.submissionId;
  if (metadata?.ipAddress) updates.ipAddress = metadata.ipAddress;
  
  // Determine category from action
  if (log.action.includes('COURSE')) updates.category = 'COURSE';
  else if (log.action.includes('ASSIGNMENT')) updates.category = 'ASSIGNMENT';
  // ... etc
  
  if (Object.keys(updates).length > 0) {
    await prisma.activityLog.update({
      where: { id: log.id },
      data: updates
    });
  }
}
```

### Step 3: Update Application Code
```typescript
// New activity log creation pattern
await prisma.activityLog.create({
  data: {
    userId: session.user.id,
    action: 'UPDATE_ASSIGNMENT',
    category: 'ASSIGNMENT',
    courseId: assignment.courseId,
    assignmentId: assignment.id,
    ipAddress: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    metadata: {
      updatedFields: ['isPublished'],
      previousValue: false,
      newValue: true
    }
  }
});
```

## Performance Comparison

### Current Query (Slow)
```sql
SELECT * FROM ActivityLog 
WHERE JSON_EXTRACT(metadata, '$.courseId') = 'course123'
ORDER BY timestamp DESC;
```

### Optimized Query (Fast)
```sql
SELECT * FROM ActivityLog 
WHERE courseId = 'course123'
ORDER BY timestamp DESC;
-- Uses index on (courseId, timestamp)
```

## Recommendation

**Choose Option 1** for these reasons:
1. ✅ **Minimal disruption** to existing code
2. ✅ **Significant performance improvement** 
3. ✅ **Maintains flexibility** with metadata
4. ✅ **Easy to implement** and migrate
5. ✅ **Future-proof** - can extend with more columns as needed

The normalized foreign key approach gives you the best balance of performance, maintainability, and flexibility while preserving your existing investment in the metadata approach.
