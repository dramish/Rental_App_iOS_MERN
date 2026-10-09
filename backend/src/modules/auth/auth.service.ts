import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { signAccessToken } from '../../middleware/auth';
import type { Role } from '../../types/express';
import { User } from './user.model';
import { RefreshToken } from './refreshToken.model';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string; role: Role };
}

async function issueTokens(
  user: { _id: Types.ObjectId; email: string; name: string; role: string },
  familyId: string,
): Promise<AuthResult> {
  const raw = randomBytes(32).toString('base64url');
  await RefreshToken.create({
    userId: user._id,
    familyId,
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  const id = String(user._id);
  return {
    accessToken: signAccessToken(id, user.role as Role),
    refreshToken: raw,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    user: { id, email: user.email, name: user.name, role: user.role as Role },
  };
}

export async function register(input: {
  email: string;
  password: string;
  name: string;
  role: 'customer' | 'shop' | 'driver';
}): Promise<AuthResult> {
  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) throw new AppError(409, 'email_taken', 'Email already registered');
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const user = await User.create({ email: input.email, passwordHash, name: input.name, role: input.role });
  return issueTokens(user, randomUUID());
}

export async function login(input: { email: string; password: string }): Promise<AuthResult> {
  const user = await User.findOne({ email: input.email.toLowerCase() });
  // Same error for unknown email and bad password: no account enumeration.
  const ok = user?.passwordHash ? await bcrypt.compare(input.password, user.passwordHash) : false;
  if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
  return issueTokens(user, randomUUID());
}

export async function refresh(rawToken: string): Promise<AuthResult> {
  const doc = await RefreshToken.findOne({ tokenHash: sha256(rawToken) });
  if (!doc || doc.revokedAt || doc.expiresAt < new Date()) {
    throw new AppError(401, 'invalid_refresh_token', 'Invalid refresh token');
  }

  // Atomic claim: exactly one caller can flip usedAt from null.
  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: doc._id, usedAt: null },
    { $set: { usedAt: new Date() } },
  );
  if (!claimed) {
    // Token was already used: treat as theft, kill the whole family.
    await RefreshToken.updateMany({ familyId: doc.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw new AppError(401, 'refresh_token_reuse', 'Refresh token reuse detected');
  }

  const user = await User.findById(doc.userId);
  if (!user) throw new AppError(401, 'invalid_refresh_token', 'Invalid refresh token');
  return issueTokens(user, doc.familyId);
}

export async function logout(rawToken: string): Promise<void> {
  const doc = await RefreshToken.findOne({ tokenHash: sha256(rawToken) });
  if (doc) {
    await RefreshToken.updateMany({ familyId: doc.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
}
