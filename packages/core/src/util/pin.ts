/**
 * Supervisor PINs for on-phone sign-off. Only a salted PBKDF2-SHA-256 hash is
 * stored, on the device, and never sent to the server. A PIN is a speed bump,
 * not strong authentication; server-side supervisor accounts (passkeys) are
 * the stronger path when sync is in use.
 */

const ITERATIONS = 210_000;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function isValidPin(pin: string): boolean {
  if (!/^\d{4,8}$/.test(pin)) return false;
  // Refuse trivially guessable PINs.
  if (/^(\d)\1+$/.test(pin)) return false;
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return false;
  return true;
}

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, key, 256);
  return toHex(bits);
}

export async function hashPin(pin: string): Promise<{ pinSalt: string; pinHash: string }> {
  if (!isValidPin(pin)) throw new Error('Use 4–8 digits that are not all the same or in sequence.');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { pinSalt: toHex(salt), pinHash: await derive(pin, salt) };
}

export async function checkPin(pin: string, stored: { pinSalt?: string; pinHash?: string }): Promise<boolean> {
  if (!stored.pinSalt || !stored.pinHash) return false;
  const candidate = await derive(pin, fromHex(stored.pinSalt));
  // Constant-time comparison.
  let diff = candidate.length ^ stored.pinHash.length;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ (stored.pinHash.charCodeAt(i) || 0);
  return diff === 0;
}
