import { afterEach, describe, expect, test } from 'bun:test';
import { securityHeaders } from '../server/session.ts';

const original = process.env.NODE_ENV;
afterEach(() => { if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original; });
function headers(environment: string) {
  process.env.NODE_ENV = environment;
  const values = new Map<string, string>();
  let continued = false;
  securityHeaders({} as any, { setHeader: (key: string, value: string) => values.set(key, value) } as any, () => { continued = true; });
  expect(continued).toBe(true);
  return values;
}
describe('security headers', () => {
  test('production restricts script execution and network connections', () => {
    const values = headers('production');
    const csp = values.get('Content-Security-Policy')!;
    expect(csp.split('; ')).toContain("script-src 'self'");
    expect(csp.split('; ')).toContain("connect-src 'self'");
    for (const directive of ["object-src 'none'", "frame-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"]) expect(csp).toContain(directive);
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).not.toContain('unsafe-eval');
    expect(values.get('X-Frame-Options')).toBe('DENY');
  });
  test('development leaves Vite inline scripts and HMR unblocked', () => {
    expect(headers('development').has('Content-Security-Policy')).toBe(false);
    expect(headers('test').has('Content-Security-Policy')).toBe(false);
  });
});
