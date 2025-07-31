import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { signToken } from '@/app/utils/jwt';

export async function authenticateUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;

  const token = signToken({ userId: user.id }, '15m');

  const { password: _pw, ...safeUser } = user;
  return { token, user: safeUser };
}
