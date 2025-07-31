import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const type = formData.get('type') as string;
    const courseId = formData.get('courseId') as string;
    const maxStates = formData.get('maxStates') as string | null;
    const isDeterministic = formData.get('isDeterministic') === 'true';

    const file = formData.get('file') as File | null;

    if (!title || !file || !courseId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Save uploaded file to /public/uploads/problems
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'problems');
    fs.mkdirSync(uploadsDir, { recursive: true });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = `${Date.now()}-${file.name}`;
    fs.writeFileSync(path.join(uploadsDir, fileName), buffer);

    // Create DB entry
    const problem = await prisma.problem.create({
      data: {
        title,
        description,
        type,
        courseId,
        fileName,
        originalFileName: file.name,
        maxStates: maxStates ? parseInt(maxStates, 10) : null,
        isDeterministic: type === 'FA' ? isDeterministic : null,
      },
    });

    return NextResponse.json(problem);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
