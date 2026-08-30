import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { API, anonymousSession, createTestApp, expectErrorEnvelope, http } from './helpers';

function freshEmail(): string {
  return `e2e-${randomUUID()}@preisora.test`;
}

describe('auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/anonymous', () => {
    it('issues a real token pair for the scan-before-signup funnel', async () => {
      const { body } = await http(app).post(`${API}/auth/anonymous`).expect(201);
      expect(Object.keys(body).sort()).toEqual(['accessToken', 'expiresIn', 'refreshToken']);
      expect(body.expiresIn).toBe(900);
      expect(body.accessToken.split('.')).toHaveLength(3);
    });

    it('creates a DISTINCT account per call', async () => {
      const a = await anonymousSession(app);
      const b = await anonymousSession(app);

      const meA = await http(app).get(`${API}/users/me`).set('Authorization', a.auth).expect(200);
      const meB = await http(app).get(`${API}/users/me`).set('Authorization', b.auth).expect(200);
      expect(meA.body.id).not.toBe(meB.body.id);
      expect(meA.body.email).toBeNull();
      expect(meA.body.countryCode).toBe('DE');
      expect(meA.body.locale).toBe('de-DE');
    });
  });

  describe('POST /auth/register', () => {
    it('creates a fresh account without a bearer token', async () => {
      const email = freshEmail();
      const { body } = await http(app)
        .post(`${API}/auth/register`)
        .send({ email, password: 'sicheres-passwort-1', displayName: 'Testnutzer' })
        .expect(201);

      const me = await http(app)
        .get(`${API}/users/me`)
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
      expect(me.body.email).toBe(email);
      expect(me.body.displayName).toBe('Testnutzer');
    });

    it('UPGRADES an anonymous account in place, keeping users.id', async () => {
      const anon = await anonymousSession(app);
      const before = await http(app)
        .get(`${API}/users/me`)
        .set('Authorization', anon.auth)
        .expect(200);

      const email = freshEmail();
      const upgraded = await http(app)
        .post(`${API}/auth/register`)
        .set('Authorization', anon.auth)
        .send({ email, password: 'sicheres-passwort-1' })
        .expect(201);

      const after = await http(app)
        .get(`${API}/users/me`)
        .set('Authorization', `Bearer ${upgraded.body.accessToken}`)
        .expect(200);

      // The one primary identity survives the upgrade (constitution §11).
      expect(after.body.id).toBe(before.body.id);
      expect(after.body.email).toBe(email);
    });

    it('rejects a duplicate email with VALIDATION_FAILED, not a 409', async () => {
      const email = freshEmail();
      await http(app)
        .post(`${API}/auth/register`)
        .send({ email, password: 'sicheres-passwort-1' })
        .expect(201);

      const { body } = await http(app)
        .post(`${API}/auth/register`)
        .send({ email, password: 'anderes-passwort-2' })
        .expect(400);

      expectErrorEnvelope(body, 'VALIDATION_FAILED');
      expect(body.messageKey).toBe('error.email_already_registered');
    });

    it.each([
      { email: 'not-an-email', password: 'sicheres-passwort-1' },
      { email: 'ok@preisora.test', password: 'short' },
      { password: 'sicheres-passwort-1' },
    ])('rejects an invalid payload %o', async (payload) => {
      const { body } = await http(app).post(`${API}/auth/register`).send(payload).expect(400);
      expectErrorEnvelope(body, 'VALIDATION_FAILED');
    });
  });

  describe('POST /auth/login', () => {
    it('accepts the registered credentials', async () => {
      const email = freshEmail();
      await http(app)
        .post(`${API}/auth/register`)
        .send({ email, password: 'sicheres-passwort-1' })
        .expect(201);

      const { body } = await http(app)
        .post(`${API}/auth/login`)
        .send({ email, password: 'sicheres-passwort-1' })
        .expect(200);
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
    });

    it('answers UNAUTHORIZED identically for a wrong password and an unknown email', async () => {
      const email = freshEmail();
      await http(app)
        .post(`${API}/auth/register`)
        .send({ email, password: 'sicheres-passwort-1' })
        .expect(201);

      const wrongPassword = await http(app)
        .post(`${API}/auth/login`)
        .send({ email, password: 'falsches-passwort' })
        .expect(401);
      const unknownEmail = await http(app)
        .post(`${API}/auth/login`)
        .send({ email: freshEmail(), password: 'sicheres-passwort-1' })
        .expect(401);

      expectErrorEnvelope(wrongPassword.body, 'UNAUTHORIZED');
      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body.messageKey).toBe('error.invalid_credentials');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the token pair and invalidates the presented token', async () => {
      const session = await anonymousSession(app);

      const refreshed = await http(app)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      expect(refreshed.body.refreshToken).not.toBe(session.refreshToken);

      // The new access token still resolves to the SAME account.
      const me = await http(app)
        .get(`${API}/users/me`)
        .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
        .expect(200);
      expect(me.body.id).toBeTruthy();

      // Single use: replaying the old refresh token fails.
      const replay = await http(app)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      expectErrorEnvelope(replay.body, 'UNAUTHORIZED');
    });

    it('rejects an unknown refresh token', async () => {
      const { body } = await http(app)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: 'nope' })
        .expect(401);
      expectErrorEnvelope(body, 'UNAUTHORIZED');
    });
  });

  describe('guarded endpoints', () => {
    it.each([
      ['get', '/users/me'],
      ['get', '/favorites'],
      ['get', '/alerts'],
      ['get', '/shopping-lists'],
    ])('answers 401 UNAUTHORIZED for %s %s without a token', async (method, path) => {
      const response = await (http(app) as never as Record<string, (p: string) => never>)[method](
        `${API}${path}`,
      );
      expect((response as { status: number }).status).toBe(401);
      expectErrorEnvelope((response as { body: unknown }).body, 'UNAUTHORIZED');
    });

    it('answers 401 for a garbage bearer token', async () => {
      const { body } = await http(app)
        .get(`${API}/users/me`)
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
      expectErrorEnvelope(body, 'UNAUTHORIZED');
    });

    it('updates the current user', async () => {
      const session = await anonymousSession(app);
      const { body } = await http(app)
        .patch(`${API}/users/me`)
        .set('Authorization', session.auth)
        .send({ displayName: 'Neuer Name', locale: 'de-AT' })
        .expect(200);
      expect(body.displayName).toBe('Neuer Name');
      expect(body.locale).toBe('de-AT');
    });
  });

  describe('stubbed operations answer 501 FEATURE_NOT_AVAILABLE', () => {
    it('POST /auth/oauth', async () => {
      const { body } = await http(app)
        .post(`${API}/auth/oauth`)
        .send({ provider: 'apple', idToken: 'whatever' })
        .expect(501);
      expectErrorEnvelope(body, 'FEATURE_NOT_AVAILABLE');
      expect(body.retryable).toBe(false);
    });

    it('GET and POST /auth/identities', async () => {
      const session = await anonymousSession(app);
      const list = await http(app)
        .get(`${API}/auth/identities`)
        .set('Authorization', session.auth)
        .expect(501);
      expectErrorEnvelope(list.body, 'FEATURE_NOT_AVAILABLE');

      const link = await http(app)
        .post(`${API}/auth/identities`)
        .set('Authorization', session.auth)
        .send({ provider: 'apple', idToken: 'whatever' })
        .expect(501);
      expectErrorEnvelope(link.body, 'FEATURE_NOT_AVAILABLE');
    });

    it('DELETE /auth/identities/{id}', async () => {
      const session = await anonymousSession(app);
      const { body } = await http(app)
        .delete(`${API}/auth/identities/00000000-0000-4000-8000-000000000000`)
        .set('Authorization', session.auth)
        .expect(501);
      expectErrorEnvelope(body, 'FEATURE_NOT_AVAILABLE');
    });

    it('GET and PATCH /users/me/preferences', async () => {
      const session = await anonymousSession(app);
      const read = await http(app)
        .get(`${API}/users/me/preferences`)
        .set('Authorization', session.auth)
        .expect(501);
      expectErrorEnvelope(read.body, 'FEATURE_NOT_AVAILABLE');

      const write = await http(app)
        .patch(`${API}/users/me/preferences`)
        .set('Authorization', session.auth)
        .send({ searchRadiusMeters: 3000 })
        .expect(501);
      expectErrorEnvelope(write.body, 'FEATURE_NOT_AVAILABLE');
    });

    it('still requires authentication before answering 501', async () => {
      const { body } = await http(app).get(`${API}/users/me/preferences`).expect(401);
      expectErrorEnvelope(body, 'UNAUTHORIZED');
    });
  });
});
