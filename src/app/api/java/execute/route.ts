import { NextRequest, NextResponse } from 'next/server';
import JavaRunner from '../../../../../lib/java-runner';
import path from 'path';

function getJavaRunnerCtor() {
  const maybeCtor =
    typeof JavaRunner === 'function'
      ? JavaRunner
      : (JavaRunner as unknown as { default?: unknown })?.default;

  if (typeof maybeCtor !== 'function') {
    throw new Error('Java runner constructor is unavailable');
  }

  return maybeCtor as typeof JavaRunner;
}

function createJavaRunner(jarPath: string) {
  const JavaRunnerCtor = getJavaRunnerCtor();
  try {
    return new JavaRunnerCtor(jarPath);
  } catch {
    return (
      JavaRunnerCtor as unknown as (path: string) => {
        execute: (
          args?: string[],
          options?: { input?: string },
        ) => Promise<{
          stdout: string;
          stderr: string;
          exitCode: number;
        }>;
        validateJarExists: () => boolean;
      }
    )(jarPath);
  }
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return 'Unknown error';
  }
}

/**
 * API endpoint to execute Java .jar files
 * POST /api/java/execute
 */
export async function POST(request: NextRequest) {
  try {
    const { jarFile, args = [], input } = await request.json();

    if (!jarFile) {
      return NextResponse.json({ error: 'jarFile parameter is required' }, { status: 400 });
    }

    // Construct path to JAR file (assuming they're in a 'jars' directory)
    const jarPath = path.join(process.cwd(), 'jars', jarFile);

    // Create Java runner instance
    const javaRunner = createJavaRunner(jarPath);

    // Validate JAR file exists
    if (!javaRunner.validateJarExists()) {
      return NextResponse.json({ error: `JAR file not found: ${jarFile}` }, { status: 404 });
    }

    // Execute the JAR file
    const result = await javaRunner.execute(args, { input });

    return NextResponse.json({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  } catch (error: unknown) {
    console.error('Java execution error:', error);
    return NextResponse.json(
      {
        error: 'Failed to execute Java application',
        details: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/java/status - Check Java availability
 */
export async function GET() {
  try {
    const JavaRunnerCtor = getJavaRunnerCtor();
    const isAvailable = await JavaRunnerCtor.isJavaAvailable();
    const version = isAvailable ? await JavaRunnerCtor.getJavaVersion() : null;

    return NextResponse.json({
      javaAvailable: isAvailable,
      javaVersion: version,
    });
  } catch (error: unknown) {
    return NextResponse.json({
      javaAvailable: false,
      error: getErrorMessage(error),
    });
  }
}
