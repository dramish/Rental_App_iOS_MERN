import { Schema, model, Types } from 'mongoose';

/**
 * One row per issued refresh token. Tokens in the same login share a familyId.
 * Rotation: using a token marks it used and issues a child in the same family.
 * Reuse of a used token => the whole family is revoked (theft signal).
 */
const refreshTokenSchema = new Schema({
  userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
  familyId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  usedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
});
// TTL: Mongo deletes the row once expiresAt passes.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
