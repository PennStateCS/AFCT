import { spawn, exec } from 'child_process';
import fs from 'fs';

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
      // cannot exhaust host memory.
      const jvmArgs = [];
      if (options.maxMemoryMb && Number(options.maxMemoryMb) > 0) {
        jvmArgs.push(`-Xmx${Math.trunc(Number(options.maxMemoryMb))}m`);
        jvmArgs.push('-XX:+ExitOnOutOfMemoryError');
      }
      const fullArgs = [...jvmArgs, '-jar', this.jarPath, ...this.defaultArgs, ...args];

      // Merge environment variables with defaults for AFCT evaluator
      const defaultEnv = {
        CFGANALYZER_LIMIT: process.env.CFGANALYZER_LIMIT || '15',
        CFGANALYZER_BINARY: process.env.CFGANALYZER_BINARY || '/app/bin/cfganalyzer'
      };

      const javaProcess = spawn(this.javaPath, fullArgs, {
        cwd: options.workingDir || this.workingDir,
        env: { ...process.env, ...defaultEnv, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

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

      javaProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      javaProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      javaProcess.on('close', (exitCode) => {
        clearTimer();
        // A killed process also fires 'close', so check timedOut first to report
        // the real cause rather than a misleading non-zero exit.
        if (timedOut) {
          reject(new Error(`Java process timed out after ${timeoutMs}ms and was terminated.`));
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
    const fullArgs = ['-jar', this.jarPath, ...this.defaultArgs, ...args];
    
    // Merge environment variables with defaults for AFCT evaluator
    const defaultEnv = {
      CFGANALYZER_LIMIT: process.env.CFGANALYZER_LIMIT || '15',
      CFGANALYZER_BINARY: process.env.CFGANALYZER_BINARY || '/app/bin/cfganalyzer'
    };
    
    const javaProcess = spawn(this.javaPath, fullArgs, {
      cwd: this.workingDir,
      env: { ...process.env, ...defaultEnv },
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
