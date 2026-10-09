export type Role = 'customer' | 'shop' | 'driver' | 'admin';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: { userId: string; role: Role };
    }
  }
}
