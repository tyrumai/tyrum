import type { RawData } from "ws";

export function rawDataToUtf8(data: RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf-8");
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf-8");
  }

  return Buffer.from(data).toString("utf-8");
}

