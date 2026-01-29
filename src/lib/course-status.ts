export function getCourseStatusTag(course: {
  isArchived: boolean;
  isPublished: boolean;
  startDate: string | Date;
  endDate: string | Date;
}) {
  let status = '';
  let bgColor = '';

  // Archived
  if (course.isArchived) {
    status = 'Archived';
    bgColor = 'bg-gray-700';
  }

  // Unpublished
  else if (!course.isPublished) {
    status = 'Not Published';
    bgColor = 'bg-yellow-700';
  }

  // Published
  else {
    // Dates
    const now = new Date();
    const start = new Date(course.startDate);
    const end = new Date(course.endDate);

    // Upcoming
    if (start > now) {
      status = 'Upcoming';
      bgColor = 'bg-cyan-700';
    }

    // Ended
    else if (end <= now) {
      status = 'Ended';
      bgColor = 'bg-red-700';
    }
    
    // Active
    else {
      status = 'Active';
      bgColor = 'bg-green-700';
    }
  }
  return { status, bgColor };
}