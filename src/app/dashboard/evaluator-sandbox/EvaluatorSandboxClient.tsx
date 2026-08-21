'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { LimitField } from '@/components/ui/LimitField';
import SwitchField from '@/components/ui/SwitchField';
import Spinner from '@/components/ui/spinner';
import FileUploadInput from '@/components/FileUploadInput';
import { useMaxUploadSize } from '@/hooks/use-max-upload-size';
import { fetchJson } from '@/lib/query-fetch';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { isTrialFinished, type EvaluatorTrialView } from '@/lib/evaluator-trial-view';

// The same four the problem dialog offers, so staff see one set of choices across the app.
const PROBLEM_TYPES = [
  { value: 'FA', label: 'Finite Automaton' },
  { value: 'PDA', label: 'Push-Down Automaton' },
  { value: 'CFG', label: 'Context-Free Grammar' },
  { value: 'RE', label: 'Regular Expression' },
] as const;

const ACCEPTED_FILES = '.txt,.fa,.pda,.cfg,.re,.jff';

/** Poll while the run is live; a second is fast enough to feel immediate. */
const POLL_MS = 1_000;

function formatRuntime(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** What the reader is waiting on, in their words rather than the queue's. */
function statusText(trial: EvaluatorTrialView): string {
  if (trial.state === 'PENDING') return 'Waiting for a free evaluator.';
  if (trial.state === 'PROCESSING') return 'Running.';
  return trial.state === 'COMPLETED' ? 'Finished.' : 'Could not finish.';
}

export default function EvaluatorSandboxClient() {
  const queryClient = useQueryClient();
  const { maxMb } = useMaxUploadSize();

  const [type, setType] = useState<(typeof PROBLEM_TYPES)[number]['value']>('FA');
  const [unlimitedStates, setUnlimitedStates] = useState(true);
  const [maxStates, setMaxStates] = useState<string>('');
  const [isDeterministic, setIsDeterministic] = useState(false);
  const [answerFile, setAnswerFile] = useState<File | undefined>();
  const [submissionFile, setSubmissionFile] = useState<File | undefined>();

  const [trialId, setTrialId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: trial } = useQuery({
    queryKey: queryKeys.evaluatorTrial(trialId ?? ''),
    queryFn: () => fetchJson<EvaluatorTrialView>(apiPaths.evaluatorTrial(trialId as string)),
    enabled: trialId !== null,
    // Stop as soon as there is a verdict: the row is then static until it expires.
    refetchInterval: (query) =>
      query.state.data && isTrialFinished(query.state.data.state) ? false : POLL_MS,
  });

  const running = trialId !== null && (!trial || !isTrialFinished(trial.state));
  const canRun = !!answerFile && !!submissionFile && !starting && !running;

  const run = async () => {
    if (!answerFile || !submissionFile) return;
    setStarting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('type', type);
      if (type === 'FA' || type === 'PDA') {
        form.set('maxStates', unlimitedStates ? '-1' : maxStates);
      }
      if (type === 'FA') form.set('isDeterministic', String(isDeterministic));
      form.set('answerFile', answerFile);
      form.set('submissionFile', submissionFile);

      const res = await fetch(apiPaths.evaluatorTrials(), { method: 'POST', body: form });
      const body = (await res.json()) as EvaluatorTrialView & { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'The trial could not be started.');
        return;
      }
      queryClient.setQueryData(queryKeys.evaluatorTrial(body.id), body);
      setTrialId(body.id);
    } catch {
      setError('The trial could not be started.');
    } finally {
      setStarting(false);
    }
  };

  const clear = async () => {
    const id = trialId;
    setTrialId(null);
    setError(null);
    if (!id) return;
    // Best effort: the result expires on its own, so a failed discard costs nothing.
    try {
      await fetch(apiPaths.evaluatorTrial(id), { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    queryClient.removeQueries({ queryKey: queryKeys.evaluatorTrial(id) });
  };

  const verdict = (() => {
    if (!trial || !isTrialFinished(trial.state)) return null;
    if (trial.state === 'FAILED') return { label: 'Did not run', variant: 'warning' as const };
    if (trial.correct === true) return { label: 'Correct', variant: 'success' as const };
    if (trial.correct === false) return { label: 'Not correct', variant: 'danger' as const };
    return { label: 'No verdict', variant: 'neutral' as const };
  })();

  return (
    <div className="space-y-4 pb-8">
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="flex items-center gap-2 text-2xl">
            <FlaskConical className="h-6 w-6" aria-hidden="true" />
            Evaluator Sandbox
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            Run a pair of files through the autograder without building a course around them.
            Nothing here is graded, and both files are deleted as soon as the run finishes.
          </p>
        </CardHeader>

        {/* Capped rather than full-bleed: these are a handful of short controls, and on a
            wide screen a full-width row leaves a label and its own control at opposite
            ends of the display with nothing between them. */}
        <CardContent className="max-w-3xl space-y-6">
          {/* One narrow column rather than a grid. Max States grows a second row when it is
              limited, which left it half a control lower than whatever sat beside it. */}
          <div className="max-w-sm space-y-4">
            <div>
              <Label htmlFor="trial-type" className="mb-2 block text-sm font-medium">
                Problem Type
              </Label>
              <select
                id="trial-type"
                className="bg-card border-input h-9 w-full rounded border px-2"
                value={type}
                disabled={running}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                {PROBLEM_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {(type === 'FA' || type === 'PDA') && (
              <LimitField
                label="Max States"
                name="trial-max-states"
                unlimited={unlimitedStates}
                onUnlimitedChange={setUnlimitedStates}
                value={maxStates}
                onValueChange={setMaxStates}
                min={1}
                max={1000}
                placeholder="e.g. 12"
                disabled={running}
              />
            )}

            {type === 'FA' && (
              <SwitchField
                label="Deterministic"
                name="trial-deterministic"
                id="trial-deterministic"
                checked={isDeterministic}
                onCheckedChange={setIsDeterministic}
                disabled={running}
              />
            )}
          </div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <FileUploadInput
              id="trial-answer-file"
              name="answerFile"
              label="Answer File"
              description="The solution the submission is checked against."
              accept={ACCEPTED_FILES}
              maxSizeMb={maxMb}
              value={answerFile}
              disabled={running}
              onChange={setAnswerFile}
            />
            <FileUploadInput
              id="trial-submission-file"
              name="submissionFile"
              label="Submission File"
              description="The file to check, for example a student's attempt."
              accept={ACCEPTED_FILES}
              maxSizeMb={maxMb}
              value={submissionFile}
              disabled={running}
              onChange={setSubmissionFile}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={run} disabled={!canRun}>
              {starting ? 'Starting…' : 'Run'}
            </Button>
            {trialId !== null && (
              <Button variant="outline" onClick={clear} disabled={starting}>
                Clear
              </Button>
            )}
            {/* Say why the button is dead rather than leaving it greyed with no reason. */}
            {!answerFile || !submissionFile ? (
              <span className="text-muted-foreground text-sm">
                Choose both files to run a test.
              </span>
            ) : null}
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/*
        Outside the card on purpose, and never unmounted.
        The card only exists once a run has been started, so a live region inside it would be
        inserted together with its first message, which assistive tech does not reliably
        announce. It also has to carry the verdict rather than only the step: the region used to
        say "Finished." while "Correct" sat in the card header outside it, so somebody using a
        screen reader ran a file and was never told the answer, which is the only thing this
        page exists to give them.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {trialId === null
          ? ''
          : `${trial ? statusText(trial) : 'Waiting for a free evaluator.'}${
              verdict ? ` ${verdict.label}.` : ''
            }`}
      </div>

      {trialId !== null && (
        <Card>
          {/* The verdict sits beside the heading, not at the far edge of the card: on a wide
              screen "Correct" ended up an arm's length from the thing it describes. */}
          <CardHeader className="flex flex-row flex-wrap items-center gap-3">
            <CardTitle className="text-xl">Result</CardTitle>
            {verdict && <Badge variant={verdict.variant}>{verdict.label}</Badge>}
          </CardHeader>

          <CardContent className="max-w-3xl space-y-4">
            {/* One live region for the whole run, so a screen reader hears each step once. */}
            <div className="flex items-center gap-3 text-sm">
              {running && <Spinner />}
              <span aria-hidden="true">
                {trial ? statusText(trial) : 'Waiting for a free evaluator.'}
              </span>
            </div>

            {trial && isTrialFinished(trial.state) && (
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                <dt className="text-muted-foreground">Feedback</dt>
                <dd className="whitespace-pre-wrap">{trial.feedback ?? '—'}</dd>

                <dt className="text-muted-foreground">Runtime</dt>
                <dd>{formatRuntime(trial.durationMs)}</dd>

                <dt className="text-muted-foreground">Files</dt>
                <dd>
                  {trial.answerFile} against {trial.submissionFile}
                </dd>
              </dl>
            )}

            {trial?.evaluationRaw != null && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Full evaluator output</summary>
                <pre
                  tabIndex={0}
                  className="bg-muted mt-2 max-h-96 overflow-auto rounded p-3 text-xs"
                >
                  {typeof trial.evaluationRaw === 'string'
                    ? trial.evaluationRaw
                    : JSON.stringify(trial.evaluationRaw, null, 2)}
                </pre>
              </details>
            )}

            {trial?.stderr && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Evaluator warnings</summary>
                <pre
                  tabIndex={0}
                  className="bg-muted mt-2 max-h-64 overflow-auto rounded p-3 text-xs"
                >
                  {trial.stderr}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
