import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import path from 'path';
import fs from 'fs'; 

export async function GET(request: NextRequest){
	try {
		const session = await auth();
		const user = session?.user;
		
		if (!user){ //Make sure user is in a valid session
			return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
		}

		const fileName = request.nextUrl.searchParams.get('file');

		if (!fileName || fileName.includes('/') || fileName.includes('\\')){ // Check for valid file name
			return NextResponse.json({ error: 'Invalid File' }, { status: 400 });
		}

		const filePath = path.join(process.cwd(), 'private', 'uploads', 'submissions', fileName);
		
		if (!fs.existsSync(filePath)){ // Check for valid file path
			return NextResponse.json({ error: 'File at ' + filePath + ' does not exist' }, { status: 404 });
		}

		const buffer = fs.readFileSync(filePath);
		
		const headers = new Headers();
		headers.set('Content-Type', 'application/octet-stream');
		headers.set('Cache-Control', 'no-store');

		return new NextResponse(buffer, { status: 200, statusText: 'OK', headers });
	} catch (err) {
		console.error('Submission serve error: ', err);
		return NextResponse.json({ error: 'Server error' }, { status: 500 });
	}
}
