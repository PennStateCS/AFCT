/**
 * Slow-query logging for local development.
 *
 * Kept in its own module so that nothing in the production import graph reaches it. It uses
 * `chalk`, a devDependency, and the runtime image is built with `npm ci --omit=dev`, so the
 * package is simply not there in production. `lib/prisma.ts` therefore loads this with a dynamic
 * import inside its development-only branch rather than importing it at the top of the file.
 *
 * That distinction is load-bearing, not stylistic. The submission worker runs the TypeScript
 * source directly (`npx tsx src/worker.ts`), so unlike the web app it never gets a bundle with
 * dev packages baked in: a static import of a dev-only package resolves at startup and kills the
 * process. That is exactly how v0.9.4 failed to deploy.
 */

import { format } from 'sql-formatter';

/** Queries faster than this are noise; only the slow ones are worth a line. */
const SLOW_QUERY_MS = 100;

/**
 * Print slow queries from a Prisma client's query events.
 *
 * Typed loosely on purpose: the `$on('query')` overload is not present on the generated client
 * type when the log levels are configured as events, which is the same reason the call site
 * needed a cast before this moved out of `lib/prisma.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function attachSlowQueryLog(client: any): Promise<void> {
  const { default: chalk } = await import('chalk');

  client.$on('query', (e: { duration: number; query: string; params: string }) => {
    if (e.duration <= SLOW_QUERY_MS) return;
    console.log(chalk.yellowBright(`Slow Query (${e.duration}ms)`));
    try {
      console.log(chalk.gray(format(e.query, { language: 'postgresql' })));
    } catch {
      // sql-formatter throws on statements it cannot parse; the raw text still helps.
      console.log(chalk.gray(e.query));
    }
    console.log(chalk.dim(`Params: ${e.params}`));
  });
}
