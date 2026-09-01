/**
 * Whether an answer file can be used for a problem, asked in one place.
 *
 * The create and edit wizards and the Evaluator Sandbox all need this, and a rule that drifted
 * between them would accept a file on one screen and refuse the same file on another.
 */

/**
 * The extensions the file pickers offer.
 *
 * A model saved out of JFLAP turns up under any of these, which is why the list is wide. It is
 * not the check: what makes a file usable is its contents, not what it is called.
 */
export const ANSWER_FILE_EXTENSIONS = '.txt,.fa,.pda,.cfg,.re,.jff';

/** The same list as prose, for hints and messages. */
export const ANSWER_FILE_EXTENSIONS_LABEL = '.txt, .fa, .pda, .cfg, .re, .jff';

/**
 * What the pickers say before a file is chosen.
 *
 * Listing only the extensions is what made #791 confusing: a plain .txt was offered and then
 * refused, and the author had been told nothing that would explain it. Leading with the real
 * requirement costs a few words and saves the rejection.
 */
export const ANSWER_FILE_HINT = `Must be a model saved from JFLAP. The extension can be any of ${ANSWER_FILE_EXTENSIONS_LABEL}.`;

/**
 * Why this file cannot be used for the selected `problemType`, or null when it can.
 *
 * Two separate reasons, kept separate because the fix differs. A file that is not JFLAP XML at
 * all is usually the wrong file entirely; a file of the wrong structure type is the right kind
 * of file for a different problem.
 */
export function answerFileRejection(text: string, problemType: string): string | null {
  if (!text.trimStart().startsWith('<')) {
    return `That file is not a JFLAP model. The extension is fine, but the contents have to be a model saved from JFLAP. Open it in JFLAP and save it again, then upload that file.`;
  }

  // JFLAP names two of the structures differently from the problem types AFCT shows.
  const expectedType =
    problemType === 'CFG' ? 'GRAMMAR' : problemType === 'TM' ? 'TURING' : problemType;
  const typeMatch = text.match(/<type[^>]*>([\s\S]*?)<\/type>/i);
  const fileType = typeMatch?.[1]?.trim().toUpperCase();
  if (fileType && fileType !== expectedType) {
    return `This is a ${fileType} file, but the selected type is ${problemType}. Upload a ${problemType} model, or change the type to match.`;
  }

  return null;
}
