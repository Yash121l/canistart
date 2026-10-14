import { describe, expect, it } from 'vitest';
import { configDir, telemetryEnabled } from '../src/telemetry.js';

describe('telemetryEnabled', () => {
  it('is on by default outside CI and tests', () => {
    expect(telemetryEnabled({})).toBe(true);
  });

  it('honours DO_NOT_TRACK', () => {
    expect(telemetryEnabled({ DO_NOT_TRACK: '1' })).toBe(false);
    expect(telemetryEnabled({ DO_NOT_TRACK: 'true' })).toBe(false);
    expect(telemetryEnabled({ DO_NOT_TRACK: '0' })).toBe(true);
  });

  it('honours CANISTART_TELEMETRY=0', () => {
    expect(telemetryEnabled({ CANISTART_TELEMETRY: '0' })).toBe(false);
    expect(telemetryEnabled({ CANISTART_TELEMETRY: 'false' })).toBe(false);
    expect(telemetryEnabled({ CANISTART_TELEMETRY: '1' })).toBe(true);
  });

  it('is off in CI and under tests', () => {
    expect(telemetryEnabled({ CI: 'true' })).toBe(false);
    expect(telemetryEnabled({ VITEST: 'true' })).toBe(false);
  });
});

describe('configDir', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    if (process.platform === 'win32') return;
    expect(configDir({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe('/tmp/xdg/canistart');
  });
});
