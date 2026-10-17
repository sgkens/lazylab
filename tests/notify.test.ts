import { describe, expect, test } from 'bun:test';
import { buildChannelRequest, channelAccepts, LazyNotification } from '../server/notify.ts';
import { NotifyChannel } from '../server/vault.ts';

const n: LazyNotification = {
  id: 'n1',
  title: 'Pipeline #5 failed',
  body: 'api · main',
  url: 'https://gitlab.example/p/-/pipelines/5',
  level: 'failure',
  source: 'watch',
  createdAt: Date.UTC(2026, 9, 17),
  read: false
};

const channel = (over: Partial<NotifyChannel>): NotifyChannel => ({
  id: 'c1',
  type: 'webhook',
  name: 'test',
  url: 'https://hooks.example/abc/',
  events: 'all',
  enabled: true,
  createdAt: '',
  ...over
});

const body = (init: RequestInit) => JSON.parse(String(init.body));

describe('buildChannelRequest', () => {
  test('ntfy publishes JSON to the server root with topic, priority and click', () => {
    const { url, init } = buildChannelRequest(channel({ type: 'ntfy', url: 'https://ntfy.sh/', topic: 'dev', token: 'tk_1' }), n);
    expect(url).toBe('https://ntfy.sh');
    expect((init.headers as any).Authorization).toBe('Bearer tk_1');
    expect(body(init)).toEqual({
      topic: 'dev',
      title: 'Pipeline #5 failed',
      message: 'api · main',
      tags: ['rotating_light'],
      priority: 4,
      click: n.url
    });
  });

  test('gotify posts to /message with the app token header', () => {
    const { url, init } = buildChannelRequest(channel({ type: 'gotify', url: 'http://gotify.lan', token: 'APP' }), n);
    expect(url).toBe('http://gotify.lan/message');
    expect((init.headers as any)['X-Gotify-Key']).toBe('APP');
    expect(body(init).priority).toBe(8);
    expect(body(init).extras['client::notification'].click.url).toBe(n.url);
  });

  test('webhook formats', () => {
    expect(body(buildChannelRequest(channel({ format: 'json' }), n).init)).toMatchObject({ title: n.title, level: 'failure', source: 'watch' });
    expect(body(buildChannelRequest(channel({ format: 'slack' }), n).init)).toEqual({ text: `${n.title}\n${n.body}\n${n.url}` });
    expect(body(buildChannelRequest(channel({ format: 'discord' }), n).init)).toEqual({ content: `${n.title}\n${n.body}\n${n.url}` });
    // Webhook URLs are used verbatim (trailing slash kept).
    expect(buildChannelRequest(channel({}), n).url).toBe('https://hooks.example/abc/');
  });
});

describe('channelAccepts', () => {
  test('respects enabled and the failures-only filter', () => {
    expect(channelAccepts(channel({ enabled: false }), n)).toBe(false);
    expect(channelAccepts(channel({ events: 'failures' }), n)).toBe(true);
    expect(channelAccepts(channel({ events: 'failures' }), { ...n, level: 'success' })).toBe(false);
    expect(channelAccepts(channel({ events: 'all' }), { ...n, level: 'info' })).toBe(true);
  });
});
