import { Types } from 'mongoose';

export const encodeCursor = (id: Types.ObjectId | string): string =>
  Buffer.from(String(id)).toString('base64url');

export function decodeCursor(cursor: string | undefined): Types.ObjectId | undefined {
  if (!cursor) return undefined;
  const raw = Buffer.from(cursor, 'base64url').toString();
  return Types.ObjectId.isValid(raw) ? new Types.ObjectId(raw) : undefined;
}
