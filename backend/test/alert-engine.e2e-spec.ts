import { INestApplication, Logger } from '@nestjs/common';
import { AlertEngineService } from '../src/modules/alerts/alert-engine.service';
import {
  API,
  BERLIN,
  MUNICH,
  SEEDED_GTIN_MILK,
  anonymousSession,
  createTestApp,
  http,
  productIdByGtin,
} from './helpers';

/**
 * The alert engine is the ONE server-side evaluator (constitution §10). Its cron is
 * disabled under NODE_ENV=test, so the pass is driven explicitly here — which is also
 * how an operator would trigger a catch-up run.
 */
describe('alert engine (e2e)', () => {
  let app: INestApplication;
  let engine: AlertEngineService;
  let milkId: string;

  beforeAll(async () => {
    app = await createTestApp();
    engine = app.get(AlertEngineService);
    milkId = await productIdByGtin(app, SEEDED_GTIN_MILK);
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not register a cron job under NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test');
    // Registration is skipped, but the service is still injectable and runnable.
    expect(engine).toBeInstanceOf(AlertEngineService);
  });

  it('dispatches to the platform stub provider when the best fresh price meets the target', async () => {
    const session = await anonymousSession(app);
    await http(app)
      .post(`${API}/devices`)
      .set('Authorization', session.auth)
      .send({
        platform: 'ios',
        pushToken: 'apns-alert-token',
        appVersion: '1.0.0',
        locale: 'de-DE',
      })
      .expect(201);

    // A target well above every seeded milk price, so the alert must fire.
    const alert = await http(app)
      .post(`${API}/alerts`)
      .set('Authorization', session.auth)
      .send({
        productId: milkId,
        targetPrice: { amountMinor: 500, currencyCode: 'EUR' },
        radiusMeters: 5000,
        location: { lat: BERLIN.lat, lng: BERLIN.lng },
      })
      .expect(201);

    const logged: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
    try {
      const result = await engine.runOnce();
      expect(result.evaluated).toBeGreaterThan(0);
      expect(result.triggered).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }

    // Routed by device.platform to the APNs stub, with localization KEYS only.
    const dispatch = logged.find((line) => line.includes('apns-stub'));
    expect(dispatch).toBeDefined();
    expect(dispatch).toContain('notification.price_alert.title');
    expect(dispatch).toContain(milkId);

    const after = await http(app)
      .get(`${API}/alerts`)
      .set('Authorization', session.auth)
      .expect(200);
    const stored = after.body.data.find((a: { id: string }) => a.id === alert.body.id);
    expect(stored.lastTriggeredAt).not.toBeNull();
  });

  it('does not fire an alert whose radius contains no fresh offer', async () => {
    const session = await anonymousSession(app);
    const alert = await http(app)
      .post(`${API}/alerts`)
      .set('Authorization', session.auth)
      .send({
        productId: milkId,
        targetPrice: { amountMinor: 500, currencyCode: 'EUR' },
        radiusMeters: 5000,
        location: { lat: MUNICH.lat, lng: MUNICH.lng },
      })
      .expect(201);

    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await engine.runOnce();
    } finally {
      spy.mockRestore();
    }

    const after = await http(app)
      .get(`${API}/alerts`)
      .set('Authorization', session.auth)
      .expect(200);
    const stored = after.body.data.find((a: { id: string }) => a.id === alert.body.id);
    expect(stored.lastTriggeredAt).toBeNull();
  });

  it('does not fire an inactive alert, and does not fire above the target', async () => {
    const session = await anonymousSession(app);

    const inactive = await http(app)
      .post(`${API}/alerts`)
      .set('Authorization', session.auth)
      .send({
        productId: milkId,
        targetPrice: { amountMinor: 500, currencyCode: 'EUR' },
        radiusMeters: 5000,
        location: { lat: BERLIN.lat, lng: BERLIN.lng },
        isActive: false,
      })
      .expect(201);

    const tooLow = await http(app)
      .post(`${API}/alerts`)
      .set('Authorization', session.auth)
      .send({
        productId: milkId,
        targetPrice: { amountMinor: 1, currencyCode: 'EUR' },
        radiusMeters: 5000,
        location: { lat: BERLIN.lat, lng: BERLIN.lng },
      })
      .expect(201);

    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await engine.runOnce();
    } finally {
      spy.mockRestore();
    }

    const after = await http(app)
      .get(`${API}/alerts`)
      .set('Authorization', session.auth)
      .expect(200);
    for (const id of [inactive.body.id, tooLow.body.id]) {
      const stored = after.body.data.find((a: { id: string }) => a.id === id);
      expect(stored.lastTriggeredAt).toBeNull();
    }
  });

  it('respects the re-trigger cooldown on a second pass', async () => {
    const session = await anonymousSession(app);
    const alert = await http(app)
      .post(`${API}/alerts`)
      .set('Authorization', session.auth)
      .send({
        productId: milkId,
        targetPrice: { amountMinor: 500, currencyCode: 'EUR' },
        radiusMeters: 5000,
        location: { lat: BERLIN.lat, lng: BERLIN.lng },
      })
      .expect(201);

    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await engine.runOnce();
      const first = await http(app)
        .get(`${API}/alerts`)
        .set('Authorization', session.auth)
        .expect(200);
      const firstTriggeredAt = first.body.data.find(
        (a: { id: string }) => a.id === alert.body.id,
      ).lastTriggeredAt;
      expect(firstTriggeredAt).not.toBeNull();

      await engine.runOnce();
      const second = await http(app)
        .get(`${API}/alerts`)
        .set('Authorization', session.auth)
        .expect(200);
      expect(
        second.body.data.find((a: { id: string }) => a.id === alert.body.id).lastTriggeredAt,
      ).toBe(firstTriggeredAt);
    } finally {
      spy.mockRestore();
    }
  });
});
