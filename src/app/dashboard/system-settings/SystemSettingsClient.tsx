'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/lib/timezones';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import SwitchField from '@/components/ui/SwitchField';

type SystemSettingsResponse = {
  timezone: string;
  maxUploadSizeMb: number;
  allowSignup: boolean;
};

export default function SystemSettingsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState('');
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState<number | ''>('');
  const [allowSignup, setAllowSignup] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/system-settings', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load system settings');
        const data = (await res.json()) as SystemSettingsResponse;
        setTimezone(data.timezone || 'UTC');
        setMaxUploadSizeMb(Number(data.maxUploadSizeMb) || 25);
        setAllowSignup(data.allowSignup ?? true);
      } catch {
        showToast.error('Failed to load system settings.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const timezoneOptions = useMemo(
    () =>
      COMMON_TIMEZONES.map((tz) => ({
        value: tz,
        label: formatTimezoneLabel(tz),
      })),
    [],
  );

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!timezone || !COMMON_TIMEZONES.includes(timezone as (typeof COMMON_TIMEZONES)[number])) {
      showToast.error('Please select a valid timezone.');
      return;
    }

    const clampedSize = Math.max(1, Math.min(1024, Math.trunc(Number(maxUploadSizeMb) || 0)));
    setSaving(true);
    try {
      const res = await fetch('/api/system-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone, maxUploadSizeMb: clampedSize, allowSignup }),
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
      <p className="sr-only" aria-live="polite">
        {loading ? 'Loading system settings' : saving ? 'Saving system settings' : ''}
      </p>

      <Card aria-labelledby="system-settings-title">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CardTitle
              id="system-settings-title"
              role="heading"
              aria-level={1}
              className="text-2xl"
            >
              System Settings
            </CardTitle>
            <Badge variant="outline" className="bg-blue-50 text-blue-700">
              Beta Feature
            </Badge>
          </div>
          <div className="text-muted-foreground text-sm">
            Configuration tools will be added here over time.
          </div>
        </CardHeader>
      </Card>

      <Card aria-labelledby="system-settings-general-title">
        <CardHeader>
          <CardTitle
            id="system-settings-general-title"
            role="heading"
            aria-level={2}
            className="text-lg"
          >
            General
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={onSubmit}
            aria-busy={loading || saving}
            className="grid max-w-xl gap-4 rounded-md border p-4"
          >
            <SelectField
              label="Timezone"
              name="timezone"
              id="timezone"
              requiredMark
              placeholder={loading ? 'Loading timezone...' : 'Select timezone'}
              value={loading ? '' : timezone}
              onValueChange={(val) => setTimezone(val)}
              disabled={loading || saving}
              description="This is the default timezone for the server. User-specific timezones can be set in their profile settings."
              options={timezoneOptions}
            />
            <InputGroup
              label="Max upload size (MB)"
              name="maxUploadSizeMb"
              type="number"
              required
              requiredMark
              min={1}
              max={1024}
              value={maxUploadSizeMb === '' ? '' : String(maxUploadSizeMb)}
              setValue={(val) => setMaxUploadSizeMb(val === '' ? '' : Number(val))}
              disabled={loading || saving}
              description="Applies to all uploads. Range: 1–1024 MB."
            />
            <SwitchField
              id="allow-signup"
              name="allow-signup"
              label="Allow user signup"
              checked={allowSignup}
              onCheckedChange={setAllowSignup}
              disabled={loading || saving}
              descriptionPlacement="inline"
              description="When enabled, the Sign up option appears on the login page."
            />
            <div>
              <Button type="submit" aria-label="Save system settings" disabled={loading || saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
