import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  MONGO_URL: z.string().default('mongodb://localhost:27017/lend?directConnection=true'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  BCRYPT_ROUNDS: z.coerce.number().default(10),
  LOG_LEVEL: z.string().default('info'),
  HOLD_SECONDS: z.coerce.number().default(900),
  PAYMENT_PROVIDER: z.enum(['fake', 'stripe']).default('fake'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  APPLE_BUNDLE_ID: z.string().optional(),
  APNS_KEY_P8: z.string().optional(), // contents of the .p8 key (use \n for newlines)
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  APNS_PRODUCTION: z.coerce.boolean().default(false),
});

export const env = schema.parse(process.env);
