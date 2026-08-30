import { FlagContext, FlagRow, compareVersions, resolveFlag, specificity } from './flag-resolution';

function flag(overrides: Partial<FlagRow> & { enabled: boolean }): FlagRow {
  return {
    flagKey: 'visualProductScan',
    countryCode: null,
    platform: null,
    minAppVersion: null,
    cohort: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const DE_IOS: FlagContext = {
  countryCode: 'DE',
  platform: 'ios',
  appVersion: '2.1.0',
  cohort: null,
};

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.10.0', '1.9.3', 1],
    ['2.0.0', '2.0.1', -1],
    ['2', '2.0.0', 0],
    ['1.2', '1.2.1', -1],
  ])('compares %s to %s', (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected);
  });
});

describe('resolveFlag', () => {
  it('is OFF when no row matches at all — features are opt-in', () => {
    expect(resolveFlag([], 'priceHistory', DE_IOS)).toBe(false);
  });

  it('honours a global row', () => {
    expect(resolveFlag([flag({ flagKey: 'priceHistory', enabled: true })], 'priceHistory', DE_IOS)).toBe(
      true,
    );
  });

  it('lets a country-scoped row beat a global one', () => {
    const rows = [flag({ enabled: false }), flag({ countryCode: 'DE', enabled: true })];
    expect(resolveFlag(rows, 'visualProductScan', DE_IOS)).toBe(true);
  });

  it('lets country+platform beat country alone', () => {
    const rows = [
      flag({ enabled: true }),
      flag({ countryCode: 'DE', enabled: true }),
      flag({ countryCode: 'DE', platform: 'ios', enabled: false }),
    ];
    expect(resolveFlag(rows, 'visualProductScan', DE_IOS)).toBe(false);
  });

  it('ignores rows scoped to another country or platform', () => {
    const rows = [
      flag({ countryCode: 'AT', enabled: true }),
      flag({ platform: 'android', enabled: true }),
    ];
    expect(resolveFlag(rows, 'visualProductScan', DE_IOS)).toBe(false);
  });

  it('applies minAppVersion as an inclusive minimum', () => {
    const rows = [flag({ minAppVersion: '2.1.0', enabled: true })];
    expect(resolveFlag(rows, 'visualProductScan', DE_IOS)).toBe(true);
    expect(resolveFlag(rows, 'visualProductScan', { ...DE_IOS, appVersion: '2.0.9' })).toBe(false);
  });

  it('never matches a version-gated row when the client sent no version', () => {
    const rows = [flag({ minAppVersion: '1.0.0', enabled: true })];
    expect(resolveFlag(rows, 'visualProductScan', { ...DE_IOS, appVersion: null })).toBe(false);
  });

  it('never matches a platform-scoped row when the client sent no platform', () => {
    const rows = [flag({ platform: 'ios', enabled: true })];
    expect(resolveFlag(rows, 'visualProductScan', { ...DE_IOS, platform: null })).toBe(false);
  });

  it('matches a cohort-scoped row only for that cohort', () => {
    const rows = [flag({ cohort: 'beta', enabled: true })];
    expect(resolveFlag(rows, 'visualProductScan', { ...DE_IOS, cohort: 'beta' })).toBe(true);
    expect(resolveFlag(rows, 'visualProductScan', { ...DE_IOS, cohort: null })).toBe(false);
  });

  it('breaks a specificity tie on the newer row', () => {
    const rows = [
      flag({ countryCode: 'DE', enabled: false, createdAt: new Date('2026-01-01T00:00:00Z') }),
      flag({ countryCode: 'DE', enabled: true, createdAt: new Date('2026-06-01T00:00:00Z') }),
    ];
    expect(resolveFlag(rows, 'visualProductScan', DE_IOS)).toBe(true);
  });

  it('never leaks across flag keys', () => {
    const rows = [flag({ flagKey: 'receiptScanner', enabled: true })];
    expect(resolveFlag(rows, 'visualProductScan', DE_IOS)).toBe(false);
  });

  it('weights country > platform > version > cohort', () => {
    expect(specificity(flag({ countryCode: 'DE', enabled: true }))).toBeGreaterThan(
      specificity(flag({ platform: 'ios', enabled: true })),
    );
    expect(specificity(flag({ platform: 'ios', enabled: true }))).toBeGreaterThan(
      specificity(flag({ minAppVersion: '1.0.0', enabled: true })),
    );
    expect(specificity(flag({ minAppVersion: '1.0.0', enabled: true }))).toBeGreaterThan(
      specificity(flag({ cohort: 'beta', enabled: true })),
    );
  });

  it('reproduces the seeded scoped-rollout example', () => {
    // Exactly the two rows `npm run seed` writes for visualProductScan.
    const rows = [
      flag({ enabled: false }),
      flag({ countryCode: 'DE', platform: 'ios', minAppVersion: '2.0.0', enabled: true }),
    ];
    // Default caller (no platform/version headers): OFF.
    expect(
      resolveFlag(rows, 'visualProductScan', {
        countryCode: 'DE',
        platform: null,
        appVersion: null,
        cohort: null,
      }),
    ).toBe(false);
    // DE iOS 2.0.0+: ON.
    expect(
      resolveFlag(rows, 'visualProductScan', {
        countryCode: 'DE',
        platform: 'ios',
        appVersion: '2.0.0',
        cohort: null,
      }),
    ).toBe(true);
  });
});
