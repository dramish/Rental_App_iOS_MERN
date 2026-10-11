import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';
import { AppError } from '../../utils/errors';
import { appleSchema, loginSchema, refreshSchema, registerSchema } from './auth.schemas';
import * as auth from './auth.service';
import { User } from './user.model';

export const authRouter = Router();

authRouter.use(authLimiter);

authRouter.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    res.status(201).json(await auth.register(req.body));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    res.json(await auth.login(req.body));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/refresh', validateBody(refreshSchema), async (req, res, next) => {
  try {
    res.json(await auth.refresh(req.body.refreshToken));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', validateBody(refreshSchema), async (req, res, next) => {
  try {
    await auth.logout(req.body.refreshToken);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId);
    if (!user) throw new AppError(404, 'not_found', 'User not found');
    res.json({ id: String(user._id), email: user.email, name: user.name, role: user.role });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/apple', validateBody(appleSchema), async (req, res, next) => {
  try {
    res.json(await auth.loginWithApple(req.body));
  } catch (e) {
    next(e);
  }
});
