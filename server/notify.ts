/**
 * Notification delivery to push channels stored in the vault: ntfy, Gotify, generic webhook
 * (plain JSON, or Slack / Discord incoming-webhook bodies).
 */
import { NotifyChannel } from './vault.js';

export type NotifyLevel = 'success' | 'failure' | 'info';

export interface LazyNotification {
  id: string;
  title: string;
  body: string;
  url?: string;
  level: NotifyLevel;
  /** What produced it: watch, review, runner, test. */
  source: string;
  createdAt: number;
  read: boolean;
}

const DELIVERY_TIMEOUT_MS = 10_000;

const NTFY_TAGS: Record<NotifyLevel, string> = { success: 'white_check_mark', failure: 'rotating_light', info: 'bell' };

/** Builds the HTTP request for one channel. Pure, so the wire format is unit tested. */
export function buildChannelRequest(channel: NotifyChannel, n: LazyNotification): { url: string; init: RequestInit } {
  const base = channel.url.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  switch (channel.type) {
    case 'ntfy': {
      // JSON publishing to the server root avoids header encoding limits for non-ASCII titles.
      if (channel.token) headers.Authorization = `Bearer ${channel.token}`;
      return {
        url: base,
        init: {
          method: 'POST',
          headers,
          body: JSON.stringify({
            topic: channel.topic,
            title: n.title,
            message: n.body || n.title,
            tags: [NTFY_TAGS[n.level]],
            priority: n.level === 'failure' ? 4 : 3,
            ...(n.url ? { click: n.url } : {})
          })
        }
      };
    }
    case 'gotify': {
      if (channel.token) headers['X-Gotify-Key'] = channel.token;
      return {
        url: `${base}/message`,
        init: {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: n.title,
            message: n.url ? `${n.body}\n${n.url}` : n.body,
            priority: n.level === 'failure' ? 8 : 5,
            ...(n.url ? { extras: { 'client::notification': { click: { url: n.url } } } } : {})
          })
        }
      };
    }
    case 'webhook': {
      const text = [`${n.title}`, n.body, n.url].filter(Boolean).join('\n');
      const body =
        channel.format === 'slack'
          ? { text }
          : channel.format === 'discord'
            ? { content: text.slice(0, 2000) }
            : { title: n.title, body: n.body, url: n.url, level: n.level, source: n.source, createdAt: new Date(n.createdAt).toISOString() };
      return { url: channel.url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
    }
  }
}

/** Whether a channel wants this notification. */
export function channelAccepts(channel: NotifyChannel, n: LazyNotification): boolean {
  if (!channel.enabled) return false;
  return channel.events === 'all' || n.level === 'failure';
}

export async function deliver(channel: NotifyChannel, n: LazyNotification): Promise<void> {
  const { url, init } = buildChannelRequest(channel, n);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${channel.type} responded ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
  }
}
