/**
 * Rules about upload file NAMES, with no filesystem behind them.
 *
 * Deliberately a leaf module: it imports nothing, so it can be used on both sides of the
 * client boundary. The name check used to live in `lib/api/serve-file`, which reads the
 * disk and therefore pulls `fs` and `path` in with it. That is invisible until something
 * in the browser needs the same rule, at which point the build fails on a module the
 * client cannot have. Keeping the predicate here means the client and the routes apply one
 * rule rather than two that can drift.
 */

/**
 * Guards a user-supplied filename. It must be a bare basename (no directory parts)
 * with no path separators, null bytes, control characters, or `..` traversal
 * sequences. Narrows to `string` so callers can use it in a type guard.
 */
export function isSafeUploadName(file: string | null | undefined): file is string {
  return (
    typeof file === 'string' &&
    file.length > 0 &&
    // Reject path separators, null bytes, and control characters (leaves a bare
    // basename), plus any `..` traversal sequence.
    !/[\\/\x00-\x1f]/.test(file) &&
    !file.includes('..')
  );
}
