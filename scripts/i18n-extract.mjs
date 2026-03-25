import { extractMessageKeys } from "./i18n-lib.mjs";

const catalog = Object.fromEntries(extractMessageKeys().map((key) => [key, key]));
process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
