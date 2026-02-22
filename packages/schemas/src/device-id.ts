const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function base32LowerNoPad(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return out;
}

export function deviceIdFromSha256Digest(digest: Uint8Array): string {
  return `dev_${base32LowerNoPad(digest)}`;
}

