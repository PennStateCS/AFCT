'use client';

import React from 'react';

/**
 * Tri-state "allow late submissions" control for a per-student/group date override.
 *
 * A binary switch cannot represent "inherit the assignment default", so an override
 * that inherits (value `undefined`/`null`) would render as an unchecked switch and be
 * announced as "off" even when the assignment default is on. This exposes three
 * explicit choices instead: Use assignment default (inherit), On, and Off, as a
 * native radio group (fieldset + legend) so it is fully keyboard- and
 * screen-reader-operable.
 */
export function InheritableLateField({
  name,
  value,
  onChange,
  description,
}: {
  /** Radio-group name; must be unique per override row. */
  name: string;
  /** `undefined`/`null` = inherit, `true` = on, `false` = off. */
  value: boolean | null | undefined;
  onChange: (value: boolean | undefined) => void;
  description?: string;
}) {
  const current = value === undefined || value === null ? 'default' : value ? 'on' : 'off';
  const descId = description ? `${name}-desc` : undefined;

  const options: Array<{ key: 'default' | 'on' | 'off'; label: string; next: boolean | undefined }> =
    [
      { key: 'default', label: 'Use assignment default', next: undefined },
      { key: 'on', label: 'On', next: true },
      { key: 'off', label: 'Off', next: false },
    ];

  return (
    <fieldset className="space-y-1" aria-describedby={descId}>
      <legend className="text-sm font-medium">Allow late submissions</legend>
      {description ? (
        <p id={descId} className="text-muted-foreground text-xs">
          {description}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-4 pt-1">
        {options.map((opt) => (
          <label key={opt.key} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={name}
              value={opt.key}
              checked={current === opt.key}
              onChange={() => onChange(opt.next)}
              className="accent-primary"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
