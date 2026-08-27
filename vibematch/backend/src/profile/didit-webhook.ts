import { createHmac, timingSafeEqual } from 'node:crypto';

export type DiditWebhookBody = {
  session_id?: unknown;
  status?: unknown;
  webhook_type?: unknown;
  timestamp?: unknown;
  [key: string]: unknown;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const canonicalize = (value: unknown): JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(input).sort()) output[key] = canonicalize(input[key]);
    return output;
  }
  return null;
};

export const verifyDiditWebhookV2 = (
  body: DiditWebhookBody,
  signature: string | undefined,
  timestamp: string | undefined,
  secret: string,
  now: Date = new Date(),
): boolean => {
  if (
    !signature?.trim() ||
    !timestamp?.trim() ||
    !secret.trim() ||
    !/^\d+$/.test(timestamp)
  ) {
    return false;
  }
  const incoming = Number.parseInt(timestamp, 10);
  const current = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(incoming) || Math.abs(current - incoming) > 300) return false;

  const canonical = JSON.stringify(canonicalize(body));
  const expected = createHmac('sha256', secret).update(canonical).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
};

export const diditSessionRef = (body: DiditWebhookBody): string | null =>
  typeof body.session_id === 'string' && body.session_id.trim() ? body.session_id.trim() : null;
