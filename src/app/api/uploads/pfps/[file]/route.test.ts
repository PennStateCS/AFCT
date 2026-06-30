import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('fs', () => ({ default: fsMock }));
vi.mock('path', () => ({
  default: {
    join: vi.fn((...args) => args.join('/')),
  },
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/uploads/pfps/[file]', () => {
  it('returns 400 for invalid file param (empty)', async () => {
    const res = await GET(new Request('http://localhost/api/uploads/pfps/'), {
      params: Promise.resolve({ file: '' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid file');
  });

  it('returns 400 for invalid file param (path traversal)', async () => {
    const res = await GET(new Request('http://localhost/api/uploads/pfps/..'), {
      params: Promise.resolve({ file: '../secret.txt' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid file');
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/uploads/pfps/avatar.png'), {
      params: Promise.resolve({ file: 'avatar.png' }),
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when session has no user', async () => {
    authMock.mockResolvedValue({ user: null });

    const res = await GET(new Request('http://localhost/api/uploads/pfps/avatar.png'), {
      params: Promise.resolve({ file: 'avatar.png' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when file does not exist', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    fsMock.existsSync.mockReturnValue(false);

    const res = await GET(new Request('http://localhost/api/uploads/pfps/missing.png'), {
      params: Promise.resolve({ file: 'missing.png' }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('File not found on disk');
  });

  it('returns 404 when default-avatar.png is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    fsMock.existsSync.mockReturnValue(false);

    const res = await GET(new Request('http://localhost/api/uploads/pfps/default-avatar.png'), {
      params: Promise.resolve({ file: 'default-avatar.png' }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('File not found on disk');
  });

  it('returns file when authenticated and file exists', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    fsMock.existsSync.mockReturnValue(true);
    const mockBuffer = Buffer.from('fake image data');
    fsMock.promises.readFile.mockResolvedValue(mockBuffer);

    const res = await GET(new Request('http://localhost/api/uploads/pfps/avatar.png'), {
      params: Promise.resolve({ file: 'avatar.png' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="avatar.png"');
    expect(fsMock.existsSync).toHaveBeenCalledWith('/private/uploads/pfps/avatar.png');
    expect(fsMock.promises.readFile).toHaveBeenCalledWith('/private/uploads/pfps/avatar.png');
  });

  it('returns 500 when file read fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    fsMock.existsSync.mockReturnValue(true);
    fsMock.promises.readFile.mockRejectedValue(new Error('Disk error'));

    const res = await GET(new Request('http://localhost/api/uploads/pfps/avatar.png'), {
      params: Promise.resolve({ file: 'avatar.png' }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal server error');
  });

  it('returns 500 when existsSync throws error', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    fsMock.existsSync.mockImplementation(() => {
      throw new Error('FS error');
    });

    const res = await GET(new Request('http://localhost/api/uploads/pfps/avatar.png'), {
      params: Promise.resolve({ file: 'avatar.png' }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal server error');
  });
});
