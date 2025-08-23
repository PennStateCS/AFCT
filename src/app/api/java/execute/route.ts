import { NextRequest, NextResponse } from 'next/server';
const JavaRunner = require('../../../../lib/java-runner');
const path = require('path');

/**
 * API endpoint to execute Java .jar files
 * POST /api/java/execute
 */
export async function POST(request: NextRequest) {
  try {
    const { jarFile, args = [], input } = await request.json();

    if (!jarFile) {
      return NextResponse.json(
        { error: 'jarFile parameter is required' },
        { status: 400 }
      );
    }

    // Construct path to JAR file (assuming they're in a 'jars' directory)
    const jarPath = path.join(process.cwd(), 'jars', jarFile);
    
    // Create Java runner instance
    const javaRunner = new JavaRunner(jarPath);

    // Validate JAR file exists
    if (!javaRunner.validateJarExists()) {
      return NextResponse.json(
        { error: `JAR file not found: ${jarFile}` },
        { status: 404 }
      );
    }

    // Execute the JAR file
    const result = await javaRunner.execute(args, { input });

    return NextResponse.json({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    });

  } catch (error) {
    console.error('Java execution error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to execute Java application',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/java/status - Check Java availability
 */
export async function GET() {
  try {
    const isAvailable = await JavaRunner.isJavaAvailable();
    const version = isAvailable ? await JavaRunner.getJavaVersion() : null;

    return NextResponse.json({
      javaAvailable: isAvailable,
      javaVersion: version
    });
  } catch (error) {
    return NextResponse.json({
      javaAvailable: false,
      error: error.message
    });
  }
}
