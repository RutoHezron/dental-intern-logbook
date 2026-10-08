/**
 * UUIDv7: time-ordered, generated on the device so records created offline
 * never collide (blueprint §5.2). `rng` and `now` are injectable for
 * deterministic synthetic data.
 */
export function uuidv7(now: number = Date.now(), rng?: () => number): string {
  const bytes = new Uint8Array(16);
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  if (!rng && typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes.subarray(6));
  } else {
    const r = rng ?? Math.random;
    for (let i = 6; i < 16; i++) bytes[i] = Math.floor(r() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Small, fast, seedable PRNG (mulberry32). Not for security. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
