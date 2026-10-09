import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

export async function connectMongo(url: string = env.MONGO_URL): Promise<void> {
  await mongoose.connect(url);
  logger.info('mongo connected');
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
