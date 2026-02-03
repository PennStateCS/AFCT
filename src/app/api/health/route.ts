import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Basic health check - you can add more checks here like DB connectivity
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'unknown',
      version: process.env.npm_package_version || '0.1.0'
    };

    return NextResponse.json(health, { status: 200 });
  } catch {
    return NextResponse.json(
      { 
        status: 'error', 
        message: 'Health check failed',
        timestamp: new Date().toISOString()
      }, 
      { status: 503 }
    );
  }
}
