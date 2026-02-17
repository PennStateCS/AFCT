import type { Metadata } from 'next';
import CalendarClient from './CalendarClient';

export const metadata: Metadata = {
  title: 'Calendar',
};

export default function CalendarPage() {
  return <CalendarClient />;
}
