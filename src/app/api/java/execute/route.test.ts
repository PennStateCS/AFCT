import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const executeMock = vi.fn();
const validateMock = vi.fn();

type JavaRunnerStaticMock = {
  isJavaAvailable: ReturnType<typeof vi.fn>;
  getJavaVersion: ReturnType<typeof vi.fn>;
};

const JavaRunnerMock = vi.hoisted(() => {
  const fn = vi.fn().mockImplementation(() => ({
    execute: executeMock,
    validateJarExists: validateMock,
  }));
  const staticMock = fn as unknown as JavaRunnerStaticMock;
  staticMock.isJavaAvailable = vi.fn();
  staticMock.getJavaVersion = vi.fn();
  return fn;
});

vi.mock('../../../../../lib/java-runner', () => ({ default: JavaRunnerMock }));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/java/execute', () => {
  it('returns 400 when jarFile missing', async () => {
    const req = new NextRequest('http://localhost/api/java/execute', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 404 when jar file does not exist', async () => {
    validateMock.mockReturnValue(false);

    const req = new NextRequest('http://localhost/api/java/execute', {
      method: 'POST',
      body: JSON.stringify({ jarFile: 'missing.jar', args: [] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it('executes jar and returns result', async () => {
    validateMock.mockReturnValue(true);
    executeMock.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

    const req = new NextRequest('http://localhost/api/java/execute', {
      method: 'POST',
      body: JSON.stringify({ jarFile: 'tool.jar', args: ['--help'] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, stdout: 'ok', exitCode: 0 });
  });

  it('returns 500 on execution error', async () => {
    validateMock.mockReturnValue(true);
    executeMock.mockRejectedValue(new Error('boom'));

    const req = new NextRequest('http://localhost/api/java/execute', {
      method: 'POST',
      body: JSON.stringify({ jarFile: 'tool.jar', args: [] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to execute Java application');
  });
});

describe('GET /api/java/execute', () => {
  it('returns java availability and version', async () => {
    const staticMock = JavaRunnerMock as unknown as JavaRunnerStaticMock;
    staticMock.isJavaAvailable.mockResolvedValue(true);
    staticMock.getJavaVersion.mockResolvedValue('17');

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ javaAvailable: true, javaVersion: '17' });
  });

  it('returns javaAvailable false on error', async () => {
    const staticMock = JavaRunnerMock as unknown as JavaRunnerStaticMock;
    staticMock.isJavaAvailable.mockRejectedValue(new Error('fail'));

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.javaAvailable).toBe(false);
  });
});
