import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';
import { logger } from './config/logger';
import { requestId } from './middleware/requestId';
import { metricsHandler, metricsMiddleware } from './middleware/metrics';
import { errorHandler, notFound } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { skuRouter } from './modules/skus/sku.routes';

export interface AppDeps {
  /** Extra readiness checks (e.g. redis ping). Mongo is always checked. */
  extraReadiness?: () => Promise<boolean>;
}

export function createApp(deps: AppDeps = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId }));
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.use(metricsMiddleware);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    const mongoOk = mongoose.connection.readyState === 1;
    const extraOk = deps.extraReadiness ? await deps.extraReadiness().catch(() => false) : true;
    res.status(mongoOk && extraOk ? 200 : 503).json({ mongo: mongoOk, extra: extraOk });
  });
  app.get('/metrics', metricsHandler);

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/skus', skuRouter);
  app.use('/v1', v1);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
