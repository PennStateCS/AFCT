'use client';

import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useState, useEffect } from 'react';
import { ProblemType } from '@prisma/client';
import type { Problem } from '@prisma/client';

interface CreateProblemDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  onCreated?: (created?: Problem) => void;
}

export function CreateProblemDialog({
  open,
  setOpen,
  courseId,
  onCreated,
}: CreateProblemDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ProblemType>('FA');
  const [maxStates, setMaxStates] = useState<number>(100);
  const [isUnlimited, setIsUnlimited] = useState(true);
  const [isDeterministic, setIsDeterministic] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setType('FA');
      setMaxStates(100);
      setIsUnlimited(true);
      setIsDeterministic(false);
      setFile(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('type', type);
    formData.append('courseId', courseId);
    if (file) formData.append('file', file);
    if (type === 'FA' || type === 'PDA') {
      formData.append('maxStates', isUnlimited ? '-1' : String(maxStates));
    }
    if (type === 'FA') {
      formData.append('isDeterministic', String(isDeterministic));
    }

    try {
      const res = await fetch('/api/problems', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        let message = 'Failed to create problem.';
        try {
          const err = await res.json();
          message = err?.error || message;
        } catch (jsonErr) {
          // response is not JSON
        }
        console.error(message);
        alert(message);
        return;
      }

      const created = await res.json(); // <<--- this is the fix
      onCreated?.(created); // <<--- pass the created problem up
      setOpen(false);
    } catch (error) {
      console.error('Unexpected error:', error);
      alert('Something went wrong.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Problem</DialogTitle>
          <DialogDescription>
            Fill in the problem details and upload the solution file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <Label className="mb-2 block">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          <div>
            <Label className="mb-2 block">Problem Type</Label>
            <select
              className="w-full rounded border p-2"
              value={type}
              onChange={(e) => setType(e.target.value as ProblemType)}
            >
              <option value="FA">Finite Automaton</option>
              <option value="PDA">Push-Down Automaton</option>
              <option value="CFG">Context-Free Grammar</option>
              <option value="RE">Regular Expression</option>
            </select>
          </div>

          {(type === 'FA' || type === 'PDA') && (
            <div>
              <Label className="mb-2 block">Max States</Label>
              <Input
                type="number"
                min={1}
                max={1000}
                disabled={isUnlimited}
                value={isUnlimited ? '' : maxStates}
                onChange={(e) => setMaxStates(Number(e.target.value))}
              />
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isUnlimited}
                  onChange={(e) => setIsUnlimited(e.target.checked)}
                />
                <span className="text-muted-foreground text-sm">Unlimited</span>
              </div>
            </div>
          )}

          {type === 'FA' && (
            <div className="flex items-center gap-2">
              <Label className="mb-0">Deterministic:</Label>
              <Switch checked={isDeterministic} onCheckedChange={setIsDeterministic} />
            </div>
          )}

          <div>
            <Label className="mb-2 block">Answer File</Label>
            <Input
              type="file"
              accept=".txt,.fa,.pda,.cfg,.re"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit} disabled={!title || !file}>
            Create Problem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
