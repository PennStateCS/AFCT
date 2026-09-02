/**
 * Why a machine could not be shown, in words a professor can act on.
 *
 * Separate from the viewer because the useful part is the mapping, not the plumbing: which
 * refusal from the server means what, and which of them are worth trying again. It matters
 * more since the window learned to hold two machines side by side, where one can fail while
 * the other is fine and "something went wrong" says nothing about which.
 *
 * Nothing here names a status code or an exception. The reader cannot act on either.
 */
export type ViewerLoadFailure = {
  /** Short, and true: what stopped this from opening. */
  title: string;
  /** What to do about it, or why nothing can be done. */
  detail: string;
  /** Whether asking again could plausibly work. Offer a retry only when it could. */
  retryable: boolean;
};

/** What a refusal from the file route means. */
export function failureForStatus(status: number): ViewerLoadFailure {
  if (status === 401) {
    return {
      title: 'You are no longer signed in',
      detail: 'Sign in again in another tab, then try this file once more.',
      retryable: true,
    };
  }
  if (status === 403) {
    return {
      title: 'This file is not yours to open',
      detail:
        'Your account does not have access to it. If that is unexpected, ask whoever runs the course to check your role there.',
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      title: 'This file is not there any more',
      detail:
        'It may have been deleted since the link was made, or the link may name the wrong file.',
      retryable: false,
    };
  }
  if (status >= 500) {
    return {
      title: 'The server could not send the file',
      detail: 'Something went wrong at our end rather than yours. Trying again often works.',
      retryable: true,
    };
  }
  return {
    title: 'The file could not be opened',
    detail: 'The server refused the request. Trying again is worth one attempt.',
    retryable: true,
  };
}

/** The request never got an answer: offline, asleep, or the server unreachable. */
export function failureForNetwork(): ViewerLoadFailure {
  return {
    title: 'The file could not be reached',
    detail: 'Check that you are still connected, then try again.',
    retryable: true,
  };
}

/**
 * The bytes arrived but are not a machine.
 *
 * Not retryable: the same bytes will not parse the second time. Worth saying that a student's
 * upload can be the cause, since that is the one thing the reader can follow up on.
 */
export function failureForContent(): ViewerLoadFailure {
  return {
    title: 'This file is not a machine the viewer can read',
    detail:
      'It should be a JFLAP .jff file. If a student submitted it, the file itself may be damaged or of the wrong kind.',
    retryable: false,
  };
}
