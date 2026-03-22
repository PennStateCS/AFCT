'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';

type CourseLabel = { id: string; name: string } | null;
type AssignmentLabel = { id: string; title: string } | null;

type NavbarBreadcrumbContextValue = {
  courseLabel: CourseLabel;
  assignmentLabel: AssignmentLabel;
  setCourseLabel: (value: CourseLabel) => void;
  setAssignmentLabel: (value: AssignmentLabel) => void;
};

const NavbarBreadcrumbContext = createContext<NavbarBreadcrumbContextValue>({
  courseLabel: null,
  assignmentLabel: null,
  setCourseLabel: () => undefined,
  setAssignmentLabel: () => undefined,
});

export function NavbarBreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [courseLabel, setCourseLabel] = useState<CourseLabel>(null);
  const [assignmentLabel, setAssignmentLabel] = useState<AssignmentLabel>(null);

  const value = useMemo(
    () => ({ courseLabel, assignmentLabel, setCourseLabel, setAssignmentLabel }),
    [courseLabel, assignmentLabel],
  );

  return (
    <NavbarBreadcrumbContext.Provider value={value}>{children}</NavbarBreadcrumbContext.Provider>
  );
}

export function useNavbarBreadcrumbs() {
  return useContext(NavbarBreadcrumbContext);
}
