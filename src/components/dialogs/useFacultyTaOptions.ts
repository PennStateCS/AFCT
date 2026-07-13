import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { User } from '@prisma/client';
import { apiPaths } from '@/lib/api-paths';

export type RosterUser = User & { role?: string };

/** Full display name for a roster user, falling back to email. */
export function getUserName(user: User): string {
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || 'Unknown user';
}

/**
 * Loads the faculty and TA option lists for the course create/duplicate wizards. Both
 * queries share the admin-users cache keys (so sibling dialogs dedupe onto one request),
 * fire only while `open`, and surface a load failure as a toast.
 */
export function useFacultyTaOptions(open: boolean): {
  facultyList: RosterUser[];
  taList: RosterUser[];
} {
  const facultyQuery = useQuery({
    queryKey: ['admin', 'users', 'faculty'],
    queryFn: async () => {
      const res = await fetch(apiPaths.admin.users({ role: 'FACULTY' }));
      if (!res.ok) throw new Error('Failed to load faculty');
      const data = await res.json();
      return (Array.isArray(data) ? data : []) as RosterUser[];
    },
    enabled: open,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (facultyQuery.isError) toast.error('Failed to load faculty list.');
  }, [facultyQuery.isError]);

  const taQuery = useQuery({
    queryKey: ['admin', 'users', 'ta'],
    queryFn: async () => {
      const res = await fetch(apiPaths.admin.users({ role: 'TA' }));
      if (!res.ok) throw new Error('Failed to load TAs');
      const data = await res.json();
      return (Array.isArray(data) ? data : []) as RosterUser[];
    },
    enabled: open,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (taQuery.isError) toast.error('Failed to load TA list.');
  }, [taQuery.isError]);

  return { facultyList: facultyQuery.data ?? [], taList: taQuery.data ?? [] };
}
