import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80),
  role: z.enum(['customer', 'shop', 'driver']).default('customer'),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});

export const appleSchema = z.object({
  identityToken: z.string().min(20).max(4000),
  nonce: z.string().min(8).max(200), // the RAW nonce; the client sent its SHA-256 to Apple
  fullName: z.string().max(120).optional(),
});
