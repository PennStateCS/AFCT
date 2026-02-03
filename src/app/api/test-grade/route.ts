import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST() {
  try {
    
  // Create a test grade
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (prisma as any).assignmentGrade.create({
      data: {
        assignmentId: 'cmdnwyb8k0000lvjcjctu5em3', // Known assignment ID
        studentId: 'cmeeztqnh0006lv384zxfc2hu', // Known student ID
        grade: 85.5,
        feedback: 'Test grade created via API'
      }
    });
    
    
    // Count total grades
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = await (prisma as any).assignmentGrade.count();
  // Test grade creation endpoint
    
    return NextResponse.json({ 
      success: true, 
      result,
      totalGrades: count 
    });
  } catch (error) {
    console.error('Test grade creation error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
