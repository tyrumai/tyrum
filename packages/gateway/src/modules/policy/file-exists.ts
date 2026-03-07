import { access } from "node:fs/promises";

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    // Intentional: treat missing policy files as absent.
    return false;
  }
}
