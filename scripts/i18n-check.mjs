import { extractMessageKeys, parseCatalog } from "./i18n-lib.mjs";

const EN_CATALOG_PATH = "packages/operator-ui/src/i18n/messages/en.json";
const NL_CATALOG_PATH = "packages/operator-ui/src/i18n/messages/nl.json";

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

const extractedKeys = extractMessageKeys();
const { duplicates: enDuplicates, messages: enMessages } = parseCatalog(EN_CATALOG_PATH);
const { duplicates: nlDuplicates, messages: nlMessages } = parseCatalog(NL_CATALOG_PATH);

const enKeys = Object.keys(enMessages).toSorted((left, right) => left.localeCompare(right));
const nlKeys = Object.keys(nlMessages).toSorted((left, right) => left.localeCompare(right));

const issues = [];

if (enDuplicates.length > 0) {
  issues.push(`Duplicate keys in ${EN_CATALOG_PATH}: ${enDuplicates.join(", ")}`);
}
if (nlDuplicates.length > 0) {
  issues.push(`Duplicate keys in ${NL_CATALOG_PATH}: ${nlDuplicates.join(", ")}`);
}

const missingInEn = difference(extractedKeys, enKeys);
if (missingInEn.length > 0) {
  issues.push(`Missing extracted keys in ${EN_CATALOG_PATH}: ${missingInEn.join(", ")}`);
}

const missingInNl = difference(extractedKeys, nlKeys);
if (missingInNl.length > 0) {
  issues.push(`Missing extracted keys in ${NL_CATALOG_PATH}: ${missingInNl.join(", ")}`);
}

const staleInEn = difference(enKeys, nlKeys);
if (staleInEn.length > 0) {
  issues.push(`Keys only present in ${EN_CATALOG_PATH}: ${staleInEn.join(", ")}`);
}

const staleInNl = difference(nlKeys, enKeys);
if (staleInNl.length > 0) {
  issues.push(`Keys only present in ${NL_CATALOG_PATH}: ${staleInNl.join(", ")}`);
}

if (issues.length > 0) {
  for (const issue of issues) {
    console.error(issue);
  }
  process.exit(1);
}

console.log(
  `i18n check passed: ${String(extractedKeys.length)} extracted keys validated across en/nl catalogs.`,
);
