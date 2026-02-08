import { describe, it, expect } from 'vitest';
import { toEndOfDayInTimezone, toDateTimeInTimezone } from './date-utils';

describe('date-utils', () => {
  describe('toEndOfDayInTimezone', () => {
    it('should convert date string to end of day (23:59) in the specified timezone', () => {
      const result = toEndOfDayInTimezone('2024-01-15', 'America/New_York');
      // 2024-01-15 23:59 EST = 2024-01-16 04:59 UTC
      expect(result.toISOString()).toBe('2024-01-16T04:59:00.000Z');
    });

    it('should use default timezone (America/New_York) when not specified', () => {
      const result = toEndOfDayInTimezone('2024-01-15');
      // Should be same as explicitly passing America/New_York
      expect(result.toISOString()).toBe('2024-01-16T04:59:00.000Z');
    });

    it('should handle datetime string with time component', () => {
      const result = toEndOfDayInTimezone('2024-01-15T14:30', 'America/New_York');
      // 2024-01-15 14:30 EST = 2024-01-15 19:30 UTC
      expect(result.toISOString()).toBe('2024-01-15T19:30:00.000Z');
    });

    it('should handle different timezones correctly - PST', () => {
      const result = toEndOfDayInTimezone('2024-01-15', 'America/Los_Angeles');
      // 2024-01-15 23:59 PST = 2024-01-16 07:59 UTC
      expect(result.toISOString()).toBe('2024-01-16T07:59:00.000Z');
    });

    it('should handle different timezones correctly - UTC', () => {
      const result = toEndOfDayInTimezone('2024-01-15', 'UTC');
      // 2024-01-15 23:59 UTC = 2024-01-15 23:59 UTC
      expect(result.toISOString()).toBe('2024-01-15T23:59:00.000Z');
    });

    it('should handle different timezones correctly - Tokyo', () => {
      const result = toEndOfDayInTimezone('2024-01-15', 'Asia/Tokyo');
      // 2024-01-15 23:59 JST = 2024-01-15 14:59 UTC (JST is UTC+9)
      expect(result.toISOString()).toBe('2024-01-15T14:59:00.000Z');
    });

    it('should handle dates during daylight saving time transitions - spring forward', () => {
      // In 2024, DST starts on March 10 in America/New_York
      const result = toEndOfDayInTimezone('2024-03-10', 'America/New_York');
      // 2024-03-10 23:59 EDT = 2024-03-11 03:59 UTC (EDT is UTC-4)
      expect(result.toISOString()).toBe('2024-03-11T03:59:00.000Z');
    });

    it('should handle dates during daylight saving time transitions - fall back', () => {
      // In 2024, DST ends on November 3 in America/New_York
      const result = toEndOfDayInTimezone('2024-11-03', 'America/New_York');
      // 2024-11-03 23:59 EST = 2024-11-04 04:59 UTC (EST is UTC-5)
      expect(result.toISOString()).toBe('2024-11-04T04:59:00.000Z');
    });

    it('should pass through dates with Z suffix unchanged', () => {
      const input = '2024-01-15T14:30:00.000Z';
      const result = toEndOfDayInTimezone(input, 'America/New_York');
      expect(result.toISOString()).toBe(input);
    });

    it('should pass through dates with timezone offset unchanged', () => {
      const input = '2024-01-15T14:30:00+05:00';
      const result = toEndOfDayInTimezone(input, 'America/New_York');
      expect(result.toISOString()).toBe('2024-01-15T09:30:00.000Z');
    });

    it('should pass through dates with lowercase z suffix unchanged', () => {
      const input = '2024-01-15T14:30:00.000z';
      const result = toEndOfDayInTimezone(input, 'America/New_York');
      expect(result.toISOString()).toBe('2024-01-15T14:30:00.000Z');
    });

    it('should handle datetime with hour and minute', () => {
      const result = toEndOfDayInTimezone('2024-06-15T09:45', 'America/Chicago');
      // 2024-06-15 09:45 CDT = 2024-06-15 14:45 UTC (CDT is UTC-5)
      expect(result.toISOString()).toBe('2024-06-15T14:45:00.000Z');
    });

    it('should handle midnight (00:00) correctly', () => {
      const result = toEndOfDayInTimezone('2024-01-15T00:00', 'America/New_York');
      // 2024-01-15 00:00 EST = 2024-01-15 05:00 UTC
      expect(result.toISOString()).toBe('2024-01-15T05:00:00.000Z');
    });
  });

  describe('toDateTimeInTimezone', () => {
    it('should convert date string to start of day (00:00) in the specified timezone', () => {
      const result = toDateTimeInTimezone('2024-01-15', 'America/New_York');
      // 2024-01-15 00:00 EST = 2024-01-15 05:00 UTC
      expect(result.toISOString()).toBe('2024-01-15T05:00:00.000Z');
    });

    it('should use default timezone (America/New_York) when not specified', () => {
      const result = toDateTimeInTimezone('2024-01-15');
      // Should be same as explicitly passing America/New_York
      expect(result.toISOString()).toBe('2024-01-15T05:00:00.000Z');
    });

    it('should handle datetime string with time component', () => {
      const result = toDateTimeInTimezone('2024-01-15T14:30', 'America/New_York');
      // 2024-01-15 14:30 EST = 2024-01-15 19:30 UTC
      expect(result.toISOString()).toBe('2024-01-15T19:30:00.000Z');
    });

    it('should handle different timezones correctly - PST', () => {
      const result = toDateTimeInTimezone('2024-01-15', 'America/Los_Angeles');
      // 2024-01-15 00:00 PST = 2024-01-15 08:00 UTC
      expect(result.toISOString()).toBe('2024-01-15T08:00:00.000Z');
    });

    it('should handle different timezones correctly - UTC', () => {
      const result = toDateTimeInTimezone('2024-01-15', 'UTC');
      // 2024-01-15 00:00 UTC = 2024-01-15 00:00 UTC
      expect(result.toISOString()).toBe('2024-01-15T00:00:00.000Z');
    });

    it('should handle different timezones correctly - Tokyo', () => {
      const result = toDateTimeInTimezone('2024-01-15', 'Asia/Tokyo');
      // 2024-01-15 00:00 JST = 2024-01-14 15:00 UTC (JST is UTC+9)
      expect(result.toISOString()).toBe('2024-01-14T15:00:00.000Z');
    });

    it('should handle dates during daylight saving time transitions - spring forward', () => {
      // In 2024, DST starts on March 10 in America/New_York
      const result = toDateTimeInTimezone('2024-03-10', 'America/New_York');
      // 2024-03-10 00:00 EST = 2024-03-10 05:00 UTC (EST is UTC-5)
      expect(result.toISOString()).toBe('2024-03-10T05:00:00.000Z');
    });

    it('should handle dates during daylight saving time transitions - fall back', () => {
      // In 2024, DST ends on November 3 in America/New_York
      const result = toDateTimeInTimezone('2024-11-03', 'America/New_York');
      // 2024-11-03 00:00 EDT = 2024-11-03 04:00 UTC (EDT is UTC-4)
      expect(result.toISOString()).toBe('2024-11-03T04:00:00.000Z');
    });

    it('should pass through dates with Z suffix unchanged', () => {
      const input = '2024-01-15T14:30:00.000Z';
      const result = toDateTimeInTimezone(input, 'America/New_York');
      expect(result.toISOString()).toBe(input);
    });

    it('should pass through dates with timezone offset unchanged', () => {
      const input = '2024-01-15T14:30:00+05:00';
      const result = toDateTimeInTimezone(input, 'America/New_York');
      expect(result.toISOString()).toBe('2024-01-15T09:30:00.000Z');
    });

    it('should pass through dates with lowercase z suffix unchanged', () => {
      const input = '2024-01-15T14:30:00.000z';
      const result = toDateTimeInTimezone(input, 'America/New_York');
      expect(result.toISOString()).toBe('2024-01-15T14:30:00.000Z');
    });

    it('should handle datetime with hour and minute', () => {
      const result = toDateTimeInTimezone('2024-06-15T09:45', 'America/Chicago');
      // 2024-06-15 09:45 CDT = 2024-06-15 14:45 UTC (CDT is UTC-5)
      expect(result.toISOString()).toBe('2024-06-15T14:45:00.000Z');
    });

    it('should handle midnight (00:00) correctly when explicitly specified', () => {
      const result = toDateTimeInTimezone('2024-01-15T00:00', 'America/New_York');
      // 2024-01-15 00:00 EST = 2024-01-15 05:00 UTC
      expect(result.toISOString()).toBe('2024-01-15T05:00:00.000Z');
    });

    it('should handle leap year dates correctly', () => {
      const result = toDateTimeInTimezone('2024-02-29', 'America/New_York');
      // 2024-02-29 00:00 EST = 2024-02-29 05:00 UTC
      expect(result.toISOString()).toBe('2024-02-29T05:00:00.000Z');
    });
  });

  describe('difference between toEndOfDayInTimezone and toDateTimeInTimezone', () => {
    it('should default to 23:59 vs 00:00 for date-only strings', () => {
      const endOfDay = toEndOfDayInTimezone('2024-01-15', 'UTC');
      const startOfDay = toDateTimeInTimezone('2024-01-15', 'UTC');

      expect(endOfDay.toISOString()).toBe('2024-01-15T23:59:00.000Z');
      expect(startOfDay.toISOString()).toBe('2024-01-15T00:00:00.000Z');
    });

    it('should produce same result when time is specified', () => {
      const endOfDay = toEndOfDayInTimezone('2024-01-15T14:30', 'America/New_York');
      const startOfDay = toDateTimeInTimezone('2024-01-15T14:30', 'America/New_York');

      expect(endOfDay.toISOString()).toBe(startOfDay.toISOString());
      expect(endOfDay.toISOString()).toBe('2024-01-15T19:30:00.000Z');
    });
  });
});
