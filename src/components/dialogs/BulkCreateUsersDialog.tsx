'use client';

import { useState, useEffect, type ChangeEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type BulkCreateUsersDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSuccess?: () => void;
};

type ParsedCsvRow = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

type BulkCreateResult = {
  summary: {
    total: number;
    created: number;
    failed: number;
  };
  created: Array<{ row: number; email: string; userId: string }>;
  failed: Array<{ row: number; email: string | null; reason: string }>;
};

const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const nextChar = line[i + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const parseCsvText = (text: string) => {
  const lines = text.split(/\r?\n/);
  const headerLineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (headerLineIndex === -1) {
    return { rows: [] as ParsedCsvRow[], error: 'CSV is empty.' };
  }

  const headerValues = parseCsvLine(lines[headerLineIndex]).map(normalizeHeader);

  const requiredColumns = {
    firstName: ['firstname', 'first'],
    lastName: ['lastname', 'last'],
    email: ['email', 'username'],
    password: ['password', 'pass'],
  } as const;

  const getColumnIndex = (aliases: readonly string[]) =>
    headerValues.findIndex((header) => aliases.includes(header));

  const firstNameIndex = getColumnIndex(requiredColumns.firstName);
  const lastNameIndex = getColumnIndex(requiredColumns.lastName);
  const emailIndex = getColumnIndex(requiredColumns.email);
  const passwordIndex = getColumnIndex(requiredColumns.password);

  if ([firstNameIndex, lastNameIndex, emailIndex, passwordIndex].some((index) => index === -1)) {
    return {
      rows: [] as ParsedCsvRow[],
      error: 'CSV must include first name, last name, email, and password headers.',
    };
  }

  const rows: ParsedCsvRow[] = [];

  for (let i = headerLineIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.trim()) {
      continue;
    }

    const columns = parseCsvLine(line);
    const maxIndex = Math.max(firstNameIndex, lastNameIndex, emailIndex, passwordIndex);
    while (columns.length <= maxIndex) {
      columns.push('');
    }

    rows.push({
      rowNumber: i + 1,
      firstName: columns[firstNameIndex] ?? '',
      lastName: columns[lastNameIndex] ?? '',
      email: columns[emailIndex] ?? '',
      password: columns[passwordIndex] ?? '',
    });
  }

  return { rows, error: null };
};

export function BulkCreateUsersDialog({ open, setOpen, onSuccess }: BulkCreateUsersDialogProps) {
  const [fileName, setFileName] = useState<string>('');
  const [rows, setRows] = useState<ParsedCsvRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkCreateResult | null>(null);

  useEffect(() => {
    if (!open) {
      setFileName('');
      setRows([]);
      setParseError(null);
      setSubmitting(false);
      setResult(null);
    }
  }, [open]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setResult(null);

    if (!file) {
      setFileName('');
      setRows([]);
      setParseError(null);
      return;
    }

    setFileName(file.name);

    try {
      const text = await file.text();
      const parsed = parseCsvText(text);
      setRows(parsed.rows);
      setParseError(parsed.error);
    } catch {
      setRows([]);
      setParseError('Failed to read CSV file.');
    }
  };

  const handleSubmit = async () => {
    if (!rows.length) {
      return;
    }

    setSubmitting(true);
    setParseError(null);

    try {
      const res = await fetch('/api/users/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });

      const data = (await res.json()) as BulkCreateResult | { error?: string };
      if (!res.ok) {
        setParseError((data as { error?: string }).error || 'Bulk create failed.');
        return;
      }

      const bulkResult = data as BulkCreateResult;
      setResult(bulkResult);
      if (bulkResult.summary.created > 0) {
        onSuccess?.();
      }
    } catch {
      setParseError('Bulk create failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Bulk Add Users</DialogTitle>
          <DialogDescription>
            Upload a CSV with first name, last name, email, and password columns.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <label htmlFor="bulk-users-csv" className="text-sm font-medium">
              CSV file
            </label>
            <Input
              id="bulk-users-csv"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
            />
            {fileName ? (
              <p className="text-muted-foreground text-xs">Selected: {fileName}</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              Required headers: first name, last name, email, password.
            </p>
          </div>

          {parseError ? (
            <p
              role="alert"
              className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {parseError}
            </p>
          ) : null}

          {rows.length > 0 ? (
            <p className="text-sm">Parsed {rows.length} row(s). Import will skip invalid rows.</p>
          ) : null}

          {result ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded border p-3">
                <h4 className="mb-2 text-sm font-semibold">Added ({result.summary.created})</h4>
                {result.created.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No users were added.</p>
                ) : (
                  <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                    {result.created.map((item) => (
                      <li key={`${item.row}-${item.email}`}>
                        Row {item.row}: {item.email}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded border p-3">
                <h4 className="mb-2 text-sm font-semibold">Failed ({result.summary.failed})</h4>
                {result.failed.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No failed rows.</p>
                ) : (
                  <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                    {result.failed.map((item, idx) => (
                      <li key={`${item.row}-${item.email ?? 'missing'}-${idx}`}>
                        Row {item.row}: {item.email ?? '(missing email)'} - {item.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" type="button">
              {result ? 'Done' : 'Cancel'}
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting || !!parseError || rows.length === 0}>
            {submitting ? 'Importing...' : 'Import Users'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
