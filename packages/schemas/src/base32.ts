const RFC4648_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * RFC 4648 base32 encoding without padding, lowercase alphabet.
 *
 * Used for stable, URL- and filename-safe identifiers like `device_id`.
 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";

  for (const b of bytes) {
    value = (value << 8) | (b & 0xff);
    bits += 8;

    while (bits >= 5) {
      out += RFC4648_ALPHABET[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    out += RFC4648_ALPHABET[(value << (5 - bits)) & 31];
  }

  return out;
}

