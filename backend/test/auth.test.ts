import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app';
import { RefreshToken } from '../src/modules/auth/refreshToken.model';

let replSet: MongoMemoryReplSet;
const app = createApp();

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

const creds = { email: 'a@example.com', password: 'password123', name: 'Asha' };

describe('auth', () => {
  it('registers, then logs in', async () => {
    const reg = await request(app).post('/v1/auth/register').send(creds).expect(201);
    expect(reg.body.accessToken).toBeDefined();
    await request(app).post('/v1/auth/login').send({ email: creds.email, password: creds.password }).expect(200);
    await request(app).post('/v1/auth/login').send({ email: creds.email, password: 'wrong-pass' }).expect(401);
  });

  it('rejects duplicate email and invalid payloads', async () => {
    await request(app).post('/v1/auth/register').send(creds).expect(409);
    await request(app).post('/v1/auth/register').send({ email: 'nope', password: '1' }).expect(400);
  });

  it('rotates refresh tokens and detects reuse (revokes the whole family)', async () => {
    const login = await request(app)
      .post('/v1/auth/login')
      .send({ email: creds.email, password: creds.password })
      .expect(200);
    const t1: string = login.body.refreshToken;

    const rotated = await request(app).post('/v1/auth/refresh').send({ refreshToken: t1 }).expect(200);
    const t2: string = rotated.body.refreshToken;
    expect(t2).not.toEqual(t1);

    // Replaying the old token is theft: 401 and the family is revoked...
    const reuse = await request(app).post('/v1/auth/refresh').send({ refreshToken: t1 }).expect(401);
    expect(reuse.body.error.code).toBe('refresh_token_reuse');

    // ...so even the legitimately rotated token no longer works.
    await request(app).post('/v1/auth/refresh').send({ refreshToken: t2 }).expect(401);
    expect(await RefreshToken.countDocuments({ revokedAt: { $ne: null } })).toBeGreaterThan(0);
  });

  it('protects /me and catalog creation by role', async () => {
    await request(app).get('/v1/auth/me').expect(401);
    const login = await request(app)
      .post('/v1/auth/login')
      .send({ email: creds.email, password: creds.password })
      .expect(200);
    const token = login.body.accessToken;
    await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    // customer cannot create a SKU
    await request(app).post('/v1/skus').set('Authorization', `Bearer ${token}`).send({}).expect(403);
  });
});

describe('catalog pagination', () => {
  it('returns cursor pages without overlap', async () => {
    const shop = await request(app)
      .post('/v1/auth/register')
      .send({ email: 'shop@example.com', password: 'password123', name: 'Shop', role: 'shop' })
      .expect(201);
    const auth = { Authorization: `Bearer ${shop.body.accessToken}` };
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/v1/skus')
        .set(auth)
        .send({ title: `Drill ${i}`, category: 'tools', totalQty: 2, dailyPriceMinor: 10000, depositMinor: 50000 })
        .expect(201);
    }
    const p1 = await request(app).get('/v1/skus?limit=3').expect(200);
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await request(app).get(`/v1/skus?limit=3&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.items).toHaveLength(2);
    expect(p2.body.nextCursor).toBeNull();
    const ids = [...p1.body.items, ...p2.body.items].map((s: { _id: string }) => s._id);
    expect(new Set(ids).size).toBe(5);
  });
});
