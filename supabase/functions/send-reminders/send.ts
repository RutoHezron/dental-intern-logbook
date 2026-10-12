/**
 * Sending logic for daily reminders, kept free of Deno and network code so it
 * can be tested with the rest of the project. index.ts wires it to web-push
 * and the database.
 */

export interface DuePush {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  url: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one notification; throws an error with `statusCode` on failure (as web-push does). */
export type Send = (target: PushTarget, payload: string) => Promise<unknown>;

export interface SendOutcome {
  sent: string[];
  /** The browser unsubscribed or the subscription expired: delete it. */
  gone: string[];
  failed: string[];
}

/** Only an in-app path is ever sent, so a notification cannot point anywhere else. */
export function safeUrl(url: string): string {
  return /^\/[A-Za-z0-9/_?=&#.-]*$/.test(url) && !url.startsWith('//') ? url : '/';
}

export async function sendAll(due: DuePush[], send: Send, concurrency = 10): Promise<SendOutcome> {
  const out: SendOutcome = { sent: [], gone: [], failed: [] };
  let i = 0;
  const worker = async () => {
    while (i < due.length) {
      const d = due[i++]!;
      const payload = JSON.stringify({ title: d.title, body: d.body, url: safeUrl(d.url), tag: 'logbook-daily' });
      try {
        await send({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload);
        out.sent.push(d.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        (status === 404 || status === 410 ? out.gone : out.failed).push(d.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, worker));
  return out;
}
