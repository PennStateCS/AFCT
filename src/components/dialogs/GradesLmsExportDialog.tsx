'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import SelectField from '@/components/ui/SelectField';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import { useEffect, useMemo, useState } from 'react';
import type { LmsPlatform } from '@/lib/lms-grade-export';

type ExportAssignmentOption = {
  id: string;
  title: string;
};

type GradesLmsExportDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onExport: (platform: LmsPlatform, assignmentId: string) => void;
  assignments: ExportAssignmentOption[];
  disabled?: boolean;
};

const LMS_OPTIONS: Array<{ value: LmsPlatform; label: string }> = [
  { value: 'canvas', label: 'Canvas' },
  { value: 'blackboard', label: 'Blackboard' },
  { value: 'moodle', label: 'Moodle' },
  { value: 'generic', label: 'Generic CSV' },
];

export function GradesLmsExportDialog({
  open,
  setOpen,
  onExport,
  assignments,
  disabled = false,
}: GradesLmsExportDialogProps) {
  const [platform, setPlatform] = useState<LmsPlatform>('canvas');
  const [assignmentIds, setAssignmentIds] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (assignmentIds) return;
    if (assignments.length > 0) {
      setAssignmentId([assignments[0].id]);
    }
  }, [open, assignmentIds, assignments]);

  const assignmentOptions = useMemo(
    () => assignments.map((assignment) => ({ value: assignment.id, label: assignment.title })),
    [assignments],
  );

  const assignmentItems = assignmentOptions.map((item) => ({ id: item.value, label: item.label}));

  const exportDisabled = disabled || (!selectAll && assignmentIds.length === 0) || assignments.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card max-w-md">
        <DialogHeader>
          <DialogTitle>Export Grades</DialogTitle>
          <DialogDescription>
            Select your LMS to export grades in an import-ready CSV format.
          </DialogDescription>
        </DialogHeader>

        <SelectField
          label="Learning Management System"
          name="lms"
          value={platform}
          onValueChange={(value) => setPlatform(value as LmsPlatform)}
          options={LMS_OPTIONS}
          placeholder="Select LMS"
        />
        
		<label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={selectAll}
		    onCheckedChange={(value) => setSelectAll(!!value)}
		  />
          <span className='text-sm font-medium'>Export whole gradebook</span>
		</label>

        {!selectAll && <SearchableMultiSelect
          label="Assignments"
          items= {assignmentItems}
          value={assignmentIds}
          onChange={setAssignmentIds}
          placeholder="Select assignments..."
        />}

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={disabled}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onExport(platform, selectAll ? assignmentItems.map((assignment) => (assignment.id)): assignmentIds);
              setOpen(false);
            }}
            disabled={exportDisabled}
          >
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
