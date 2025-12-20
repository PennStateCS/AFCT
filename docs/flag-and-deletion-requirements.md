
# Flag and Deletion Requirements

## Flag Requirements

### Course
**course.isPublished**
- **To Publish:**
    - No restrictions
- **To Unpublish:**
    - Must not be an active course*¹

**course.isArchived**
- **To Archive:**
    - Must not be an active course*¹, **or**
    - Must be before its startDate or after its endDate
- **To Unarchive:**
    - No restrictions

### User
**user.inactive**
- **To make active:**
    - No restrictions
- **To make inactive:**
    - User must not be in any published, ongoing courses*² that are not archived

### Assignment
**assignment.isPublished**
- **To Publish:**
    - No restrictions
- **To Unpublish:**
    - No student submissions exist
    - No grades exist

## Deletion Requirements

### Course
- To delete a course, it must be **archived**

### User
- To delete a user, they must be **inactive**

### Assignment
- No restrictions on deleting an assignment

------------------------------

### Notes
¹ *Active course* means there are either student submissions or grades.
² *Ongoing course* means the date has started but not ended.