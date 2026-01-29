import jwt, { SignOptions } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

export function signToken(payload: object, expiresIn = '15m') {
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn } as SignOptions);
}

export interface JwtPayload {
  userId: string;
  iat: number;
  exp: number;
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}
