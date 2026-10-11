import { createHash } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';

export interface AppleIdentity {
  sub: string;
  email?: string;
}
export type AppleVerifier = (identityToken: string, rawNonce: string) => Promise<AppleIdentity>;

const JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * Verifies a Sign in with Apple identity token:
 *  - signature against Apple's published keys (JWKS, cached by jose)
 *  - iss = Apple, aud = our bundle id, exp not passed
 *  - nonce: the client sends SHA-256(rawNonce) to Apple and rawNonce to us; the token must carry the hash.
 *    That binds the token to this login attempt and defeats replay of a stolen token.
 */
export const verifyAppleIdentityToken: AppleVerifier = async (identityToken, rawNonce) => {
  if (!env.APPLE_BUNDLE_ID) throw new AppError(503, 'apple_not_configured', 'Sign in with Apple is not configured');
  try {
    const { payload } = await jwtVerify(identityToken, JWKS, { issuer: 'https://appleid.apple.com', audience: env.APPLE_BUNDLE_ID });
    const expected = createHash('sha256').update(rawNonce).digest('hex');
    if (payload.nonce !== expected) throw new Error('nonce mismatch');
    if (!payload.sub) throw new Error('missing sub');
    return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
  } catch {
    throw new AppError(401, 'invalid_apple_token', 'Invalid Apple identity token');
  }
};

let verifier: AppleVerifier = verifyAppleIdentityToken;
export const getAppleVerifier = (): AppleVerifier => verifier;
export const setAppleVerifier = (v: AppleVerifier): void => {
  verifier = v;
};
