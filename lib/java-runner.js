import { spawn } from 'child_process';

// The evaluator runs student-controlled files, so the Java process must NOT inherit
// the app's environment (DATABASE_URL, NEXTAUTH_SECRET, admin credentials, ...). Pass
// only the handful of variables the JVM/evaluator actually need; drop everything else.
const ENV_ALLOWLIST = [
  'PATH',
  'JAVA_HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
];

function buildEvaluatorEnv(overrides = {}) {
  const safe = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) safe[key] = process.env[key];
  }
  return {
    ...safe,
    CFGANALYZER_LIMIT: process.env.CFGANALYZER_LIMIT || '15',
    CFGANALYZER_BINARY: process.env.CFGANALYZER_BINARY || '/app/bin/cfganalyzer',
    ...overrides,
  };
}

// Hard cap on combined stdout+stderr so a submission can't exhaust memory by spewing
// output; the process is killed once it's exceeded.
const MAX_OUTPUT_BYTES = 2_000_000;

/**
 * Java Runner Utility
 * Provides methods to execute Java .jar files from Node.js
 *
 * Only `execute()` exists on purpose. There used to be a streaming variant and two
 * `exec`-based version probes; none had a caller, and the streaming one had neither
 * the output cap nor the timeout, so anything reaching for it would have reopened
 * both holes.
 */
class JavaRunner {
  constructor(jarPath, options = {}) {
    this.jarPath = jarPath;
    this.javaPath = options.javaPath || 'java';
    this.workingDir = options.workingDir || process.cwd();
    this.defaultArgs = options.defaultArgs || [];
  }

  /**
   * Execute JAR file and return a Promise with the result
   * @param {string[]} args - Arguments to pass to the Java application
   * @param {Object} options - Additional options
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   */
  async execute(args = [], options = {}) {
    return new Promise((resolve, reject) => {
      // JVM options must precede -jar. Cap the heap so a single submission
      // cannot exhaust host memory. Run headless: the evaluator is a CLI process
      // and must never try to open an X display (JFLAP pulls in Swing).
      const jvmArgs = ['-Djava.awt.headless=true'];
      if (options.maxMemoryMb && Number(options.maxMemoryMb) > 0) {
        jvmArgs.push(`-Xmx${Math.trunc(Number(options.maxMemoryMb))}m`);
        jvmArgs.push('-XX:+ExitOnOutOfMemoryError');
      }
      const fullArgs = [...jvmArgs, '-jar', this.jarPath, ...this.defaultArgs, ...args];

      const javaProcess = spawn(this.javaPath, fullArgs, {
        cwd: options.workingDir || this.workingDir,
        env: buildEvaluatorEnv(options.env),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let outputOverflow = false;

      // Append captured output up to MAX_OUTPUT_BYTES; kill the process once it's hit
      // so a runaway/hostile submission can't fill memory.
      const appendCapped = (chunk, isErr) => {
        if (outputOverflow) return;
        const remaining = MAX_OUTPUT_BYTES - (stdout.length + stderr.length);
        const text = chunk.toString();
        const slice = text.length <= remaining ? text : text.slice(0, Math.max(0, remaining));
        if (isErr) stderr += slice;
        else stdout += slice;
        if (stdout.length + stderr.length >= MAX_OUTPUT_BYTES) {
          outputOverflow = true;
          javaProcess.kill('SIGKILL');
        }
      };

      // Enforce a wall-clock timeout by killing the child process. Without this
      // a runaway evaluation would hold a worker slot indefinitely (DoS vector).
      const timeoutMs = Number(options.timeout) || 0;
      let timeoutHandle = null;
      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          javaProcess.kill('SIGKILL');
        }, timeoutMs);
      }

      const clearTimer = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      javaProcess.stdout.on('data', (data) => appendCapped(data, false));
      javaProcess.stderr.on('data', (data) => appendCapped(data, true));

      // 'close' and 'error' are terminal and settle the promise, so bind them once.
      javaProcess.once('close', (exitCode) => {
        clearTimer();
        // A killed process also fires 'close', so check the kill reasons first to
        // report the real cause rather than a misleading non-zero exit.
        if (timedOut) {
          reject(new Error(`Java process timed out after ${timeoutMs}ms and was terminated.`));
        } else if (outputOverflow) {
          reject(
            new Error(
              `Java process exceeded the ${MAX_OUTPUT_BYTES}-byte output limit and was terminated.`,
            ),
          );
        } else if (exitCode === 0) {
          resolve({ stdout, stderr, exitCode });
        } else {
          reject(new Error(`Java process exited with code ${exitCode}. stderr: ${stderr}`));
        }
      });

      javaProcess.once('error', (error) => {
        clearTimer();
        reject(new Error(`Failed to start Java process: ${error.message}`));
      });

      // Write any input, then always close stdin: an evaluator that reads to EOF would
      // otherwise hang (held open by the pipe) until the wall-clock timeout kills it.
      if (options.input) {
        javaProcess.stdin.write(options.input);
      }
      javaProcess.stdin.end();
    });
  }
}

export default JavaRunner;
