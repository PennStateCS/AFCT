'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Play, Terminal } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { fieldControlClass } from '@/components/ui/field';
import { LimitField } from '@/components/ui/LimitField';
import SwitchField from '@/components/ui/SwitchField';
import Spinner from '@/components/ui/spinner';
import FileUploadInput from '@/components/FileUploadInput';
import { useMaxUploadSize } from '@/hooks/use-max-upload-size';
import { fetchJson } from '@/lib/query-fetch';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { isTrialFinished, type EvaluatorTrialView } from '@/lib/evaluator-trial-view';
import { cn } from '@/lib/utils';

// The same four the problem dialog offers, so staff see one set of choices across the app.
const PROBLEM_TYPES = [
  { value: 'FA', label: 'Finite Automaton' },
  { value: 'PDA', label: 'Push-Down Automaton' },
  { value: 'CFG', label: 'Context-Free Grammar' },
  { value: 'RE', label: 'Regular Expression' },
] as const;

type ProblemType = (typeof PROBLEM_TYPES)[number]['value'];

/**
 * Which of the three settings a type actually carries, said in the card rather than left
 * for the reader to infer from fields that appear and disappear as they change the type.
 */
const TYPE_NOTES: Record<ProblemType, string> = {
  FA: 'A finite automaton can also be held to a state bound and to being deterministic.',
  PDA: 'A push-down automaton can be held to a state bound. Determinism applies to finite automata only.',
  CFG: 'A grammar carries no state bound and no determinism setting, so there is nothing else to set.',
  RE: 'A regular expression carries no state bound and no determinism setting, so there is nothing else to set.',
};

/**
 * How much of the configuration row the note takes: whatever the type's own controls left
 * of it. A grammar has one control, so the note fills the other two thirds rather than
 * leaving the card looking abandoned; a finite automaton has all three, so it drops to a
 * full-width line beneath them. Spelled out per type because Tailwind reads these classes
 * from the source, so they cannot be assembled at runtime.
 */
const NOTE_SPAN: Record<ProblemType, string> = {
  FA: 'sm:col-span-2 lg:col-span-3',
  PDA: 'sm:col-span-2 lg:col-span-1',
  CFG: 'lg:col-span-2',
  RE: 'lg:col-span-2',
};

const ACCEPTED_FILES = '.txt,.fa,.pda,.cfg,.re,.jff';

// A native select, the same control the problem dialog uses, wearing SelectField's trigger
// classes so the fields in this card share a height, a border and a focus ring. SelectField
// itself is a Radix listbox, and there is no shared component for the native element.
// A native <select> deliberately (the options are a short fixed list and the platform
// control is the right one here), but wearing the shared field surface so it matches the
// inputs beside it. Only the size and padding are its own.
const SELECT_CLASS = cn(fieldControlClass, 'h-11 w-full min-w-0 px-3 py-1 text-base md:text-sm');

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

  const [type, setType] = useState<ProblemType>('FA');
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
    // Capped rather than full-bleed: the workspace is as wide as the monitor, and a run
    // needs two uploads and three short controls, so past this width the cards are mostly
    // air. Same measure as the System Settings workspace.
    <div className="w-full max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          {/* Decorative: the heading beside it already says what this is. The icon the
              sidebar uses for this route, on the neutral muted tile the other tool pages
              use for theirs. */}
          <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
            <FlaskConical className="size-5" aria-hidden="true" />
          </span>
          <span>Evaluator Sandbox</span>
        </h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Run a pair of files through the autograder without building a course around them. Nothing
          here is graded, and both files are deleted as soon as the run finishes.
        </p>
      </div>

      <Card>
        <CardHeader>
          {/* Level 2 under the page title: the three cards are this page's sections, and
              CardTitle would otherwise call them level 3 and skip a step. */}
          <CardTitle aria-level={2}>Test Configuration</CardTitle>
          <CardDescription>
            The same settings a problem carries. They decide what the evaluator checks.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Three across on a desktop, which is what stops a short control from being
              stretched the width of the card: at two columns Max States put its label and
              its Unlimited/Limited toggle at opposite ends of 540px with nothing between
              them. Two columns on a tablet, one on a phone. */}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0">
              {/* The row is as tall as LimitField's, whose label shares its line with the
                  Unlimited/Limited toggle, so the two controls start at the same height
                  instead of half a control apart. */}
              <div className="mb-2 flex min-h-8 items-center">
                <Label htmlFor="trial-type" className="text-sm font-medium">
                  Problem Type
                </Label>
              </div>
              <select
                id="trial-type"
                className={SELECT_CLASS}
                value={type}
                disabled={running}
                onChange={(e) => setType(e.target.value as ProblemType)}
              >
                {PROBLEM_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground mt-1 text-xs">What both files are read as.</p>
            </div>

            {(type === 'FA' || type === 'PDA') && (
              <div className="min-w-0">
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
                {/* Unlimited hides the number input, which left a control-sized hole between
                    the two fields beside it. This says what unlimited means and stands in
                    the input's place. */}
                {unlimitedStates ? (
                  <p className="text-muted-foreground mt-1 text-xs sm:mt-0 sm:flex sm:h-11 sm:items-center">
                    Any number of states is accepted.
                  </p>
                ) : (
                  <p className="text-muted-foreground mt-1 text-xs">
                    A submission with more states than this is rejected.
                  </p>
                )}
              </div>
            )}

            {type === 'FA' && (
              <div className="min-w-0">
                {/* The switch carries its own label inside its box, so on the desktop row it
                    would sit a label's height above the two controls beside it. The spacer
                    is that missing label row, and only exists where the row does. */}
                <div className="mb-2 hidden min-h-8 lg:block" aria-hidden="true" />
                <SwitchField
                  label="Deterministic"
                  name="trial-deterministic"
                  id="trial-deterministic"
                  checked={isDeterministic}
                  onCheckedChange={setIsDeterministic}
                  description="Require the submission to be a DFA."
                  disabled={running}
                />
              </div>
            )}

            <p
              className={`bg-muted text-muted-foreground self-end rounded-md p-3 text-xs ${NOTE_SPAN[type]}`}
            >
              {TYPE_NOTES[type]}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle aria-level={2}>Files</CardTitle>
          <CardDescription>
            Two files of the chosen type: the answer, and the attempt to check against it.
          </CardDescription>
        </CardHeader>

        {/* Side by side from sm, so the pair reads as one comparison rather than two
            separate uploads. Below that they stack, which is also where a drop zone stops
            being wide enough to hold a file name on one line. */}
        <CardContent className="grid gap-5 sm:grid-cols-2">
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
        </CardContent>

        {/* The run lives in this card's footer, next to the thing that gates it. On its own
            row under the page it read as unrelated to the uploads above it, and the reason
            it was disabled sat a card away from the button. */}
        <CardFooter className="flex flex-wrap items-center justify-end gap-3 border-t">
          {error && (
            <p role="alert" className="text-destructive w-full text-sm">
              {error}
            </p>
          )}
          <span className="text-muted-foreground mr-auto text-sm">
            {!answerFile || !submissionFile
              ? 'Choose both files to run a test.'
              : 'The test joins the same queue that grades real submissions.'}
          </span>
          {trialId !== null && (
            <Button variant="outline" size="lg" onClick={clear} disabled={starting}>
              Clear
            </Button>
          )}
          <Button size="lg" onClick={run} disabled={!canRun}>
            <Play aria-hidden="true" />
            {starting ? 'Starting…' : 'Run'}
          </Button>
        </CardFooter>
      </Card>

      {/*
        Outside the result card on purpose, and never unmounted.
        A live region inserted together with its first message is not reliably announced, so
        this one has to exist before a run starts and survive Clear. It also has to carry the
        verdict rather than only the step: the region used to say "Finished." while "Correct"
        sat in the card header outside it, so somebody using a screen reader ran a file and
        was never told the answer, which is the only thing this page exists to give them.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {trialId === null
          ? ''
          : `${trial ? statusText(trial) : 'Waiting for a free evaluator.'}${
              verdict ? ` ${verdict.label}.` : ''
            }`}
      </div>

      {/* Always present, empty state and all: the page used to end at the Run button, so
          there was nothing to tell you where the answer would appear. */}
      <Card>
        {/* The verdict sits beside the heading, not at the far edge of the card: on a wide
            screen "Correct" ended up an arm's length from the thing it describes. */}
        <CardHeader className="flex flex-row flex-wrap items-center gap-3">
          <CardTitle aria-level={2}>Result</CardTitle>
          {verdict && <Badge variant={verdict.variant}>{verdict.label}</Badge>}
        </CardHeader>

        <CardContent className="space-y-4">
          {trialId === null ? (
            <div className="text-muted-foreground border-border flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
              <Terminal className="size-5" aria-hidden="true" />
              <p className="text-sm">Run a test to see the evaluator output here.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 text-sm">
                {running && <Spinner />}
                {/* The live region above says this out loud; this copy is for the eye. */}
                <span aria-hidden="true">
                  {trial ? statusText(trial) : 'Waiting for a free evaluator.'}
                </span>
              </div>

              {trial && isTrialFinished(trial.state) && (
                <dl className="grid max-w-3xl gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                  <dt className="text-muted-foreground">Feedback</dt>
                  <dd className="whitespace-pre-wrap">
                    {trial.feedback ?? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">None</span>
                      </>
                    )}
                  </dd>

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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
