import { spawn, exec } from 'child_process';
import fs from 'fs';

// The evaluator runs student-controlled files, so the Java process must NOT inherit
// the app's environment (DATABASE_URL, NEXTAUTH_SECRET, admin credentials, ...). Pass
// only the handful of variables the JVM/evaluator actually need; drop everything else.
const ENV_ALLOWLIST = ['PATH', 'JAVA_HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'HOME', 'TMPDIR', 'TEMP', 'TMP'];

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
        stdio: ['pipe', 'pipe', 'pipe']
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

      javaProcess.on('close', (exitCode) => {
        clearTimer();
        // A killed process also fires 'close', so check the kill reasons first to
        // report the real cause rather than a misleading non-zero exit.
        if (timedOut) {
          reject(new Error(`Java process timed out after ${timeoutMs}ms and was terminated.`));
        } else if (outputOverflow) {
          reject(new Error(`Java process exceeded the ${MAX_OUTPUT_BYTES}-byte output limit and was terminated.`));
        } else if (exitCode === 0) {
          resolve({ stdout, stderr, exitCode });
        } else {
          reject(new Error(`Java process exited with code ${exitCode}. stderr: ${stderr}`));
        }
      });

      javaProcess.on('error', (error) => {
        clearTimer();
        reject(new Error(`Failed to start Java process: ${error.message}`));
      });

      // Handle input if provided
      if (options.input) {
        javaProcess.stdin.write(options.input);
        javaProcess.stdin.end();
      }
    });
  }

  /**
   * Execute JAR file with streaming output (for long-running processes)
   * @param {string[]} args - Arguments to pass to the Java application
   * @param {Object} callbacks - Callbacks for stdout, stderr, and close events
   * @returns {ChildProcess} The spawned process
   */
  executeStream(args = [], callbacks = {}) {
    const fullArgs = ['-Djava.awt.headless=true', '-jar', this.jarPath, ...this.defaultArgs, ...args];
    
    const javaProcess = spawn(this.javaPath, fullArgs, {
      cwd: this.workingDir,
      env: buildEvaluatorEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (callbacks.onStdout) {
      javaProcess.stdout.on('data', callbacks.onStdout);
    }

    if (callbacks.onStderr) {
      javaProcess.stderr.on('data', callbacks.onStderr);
    }

    if (callbacks.onClose) {
      javaProcess.on('close', callbacks.onClose);
    }

    if (callbacks.onError) {
      javaProcess.on('error', callbacks.onError);
    }

    return javaProcess;
  }

  /**
   * Check if Java is available
   * @returns {Promise<boolean>}
   */
  static async isJavaAvailable() {
    return new Promise((resolve) => {
      exec('java -version', (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * Get Java version
   * @returns {Promise<string>}
   */
  static async getJavaVersion() {
    return new Promise((resolve, reject) => {
      exec('java -version', (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          // Java version is typically in stderr
          const versionOutput = stderr || stdout;
          const versionMatch = versionOutput.match(/version "(.+?)"/);
          resolve(versionMatch ? versionMatch[1] : versionOutput.trim());
        }
      });
    });
  }

  /**
   * Validate that the JAR file exists
   * @returns {boolean}
   */
  validateJarExists() {
    return fs.existsSync(this.jarPath);
  }
}

export default JavaRunner;
