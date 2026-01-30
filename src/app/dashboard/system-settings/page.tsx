"use client";

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'Pacific/Auckland',
];

const formatTimezoneLabel = (tz: string) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date());
    const tzName = parts.find((part) => part.type === 'timeZoneName')?.value;
    const offset = tzName?.replace('GMT', 'UTC') ?? 'UTC';
    return `${tz} (${offset})`;
  } catch {
    return tz;
  }
};

type SystemSettingsResponse = {
  timezone: string;
  maxUploadSizeMb: number;
};

export default function SystemSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState('UTC');
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState(25);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/system-settings', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load system settings');
        const data = (await res.json()) as SystemSettingsResponse;
        setTimezone(data.timezone || 'UTC');
        setMaxUploadSizeMb(Number(data.maxUploadSizeMb) || 25);
      } catch {
        showToast.error('Failed to load system settings.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const timezoneOptions = useMemo(
    () => COMMON_TIMEZONES.map((tz) => ({
      value: tz,
      label: formatTimezoneLabel(tz),
    })),
    []
  );

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!COMMON_TIMEZONES.includes(timezone)) {
      showToast.error('Please select a valid timezone.');
      return;
    }

    const clampedSize = Math.max(1, Math.min(1024, Math.trunc(maxUploadSizeMb || 0)));
    setSaving(true);
    try {
      const res = await fetch('/api/system-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone, maxUploadSizeMb: clampedSize }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Failed to save settings');
      }
      setMaxUploadSizeMb(clampedSize);
      showToast.success('System settings updated successfully.');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-2xl">System Settings</CardTitle>
            <Badge variant="outline" className="bg-blue-50 text-blue-700">
              Preview
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            Configuration tools will be added here over time.
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">General System Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid max-w-xl gap-4">
            <div className="grid gap-2">
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                name="timezone"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                disabled={loading || saving}
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs outline-none"
              >
                {timezoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                This will control how dates and times default across the dashboard.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="maxUploadSizeMb">Max upload size (MB)</Label>
              <input
                id="maxUploadSizeMb"
                name="maxUploadSizeMb"
                type="number"
                min={1}
                max={1024}
                value={maxUploadSizeMb}
                onChange={(event) => setMaxUploadSizeMb(Number(event.target.value))}
                disabled={loading || saving}
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs outline-none"
              />
              <p className="text-xs text-muted-foreground">
                Applies to all uploads. Range: 1–1024 MB.
              </p>
            </div>
            <div>
              <Button type="submit" disabled={loading || saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}