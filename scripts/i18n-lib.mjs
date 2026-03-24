import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";

const SOURCE_DIRS = ["packages/operator-ui/src", "apps/web/src", "apps/desktop/src/renderer"];

const STRING_CALLS = new Map([
  ["translateNode", 0],
  ["translateString", 1],
  ["translateStringAttribute", 1],
  ["formatSharedMessage", 0],
]);

const MESSAGE_DESCRIPTOR_CALLS = new Set(["formatMessage"]);

const JSX_ATTRIBUTE_NAMES = new Set([
  "aria-label",
  "cancelLabel",
  "confirmLabel",
  "confirmationLabel",
  "description",
  "emptyText",
  "helperText",
  "label",
  "placeholder",
  "secondaryLabel",
  "title",
]);

const OBJECT_PROPERTY_NAMES = new Set([
  "addLabel",
  "description",
  "emptyText",
  "helperText",
  "label",
  "mobileLabel",
  "placeholder",
  "secondaryLabel",
  "title",
]);

const JSX_TEXT_COMPONENTS = new Set([
  "Badge",
  "Button",
  "DialogDescription",
  "DialogTitle",
  "DropdownMenuItem",
  "DropdownMenuLabel",
  "InlineEmptyHint",
  "Label",
  "SectionHeading",
  "SectionLabel",
  "TabsTrigger",
  "TooltipContent",
  "option",
  "optgroup",
]);

function walkFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }
    const extension = extname(entry.name);
    if (extension === ".ts" || extension === ".tsx") {
      files.push(absolutePath);
    }
  }
  return files;
}

function normalizeMessage(value) {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function getCallName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return null;
}

function getPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return null;
}

function getJsxElementName(name) {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isPropertyAccessExpression(name)) {
    return name.name.text;
  }
  return null;
}

function extractStringFromExpression(expression) {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  return null;
}

function addNormalized(keys, value) {
  const normalized = normalizeMessage(value);
  if (normalized) {
    keys.add(normalized);
  }
}

function maybeAddExpressionString(keys, expression) {
  const extracted = extractStringFromExpression(expression);
  if (extracted !== null) {
    addNormalized(keys, extracted);
    return;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    extractFromMessageDescriptor(keys, expression);
  }
}

function extractFromMessageDescriptor(keys, expression) {
  if (!ts.isObjectLiteralExpression(expression)) {
    return;
  }

  let extracted = false;
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const propertyName = getPropertyName(property.name);
    if (propertyName === "defaultMessage") {
      maybeAddExpressionString(keys, property.initializer);
      extracted = true;
      break;
    }
  }
  if (extracted) {
    return;
  }
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const propertyName = getPropertyName(property.name);
    if (propertyName === "id") {
      maybeAddExpressionString(keys, property.initializer);
      return;
    }
  }
}

function collectFileMessages(filePath, keys) {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const isTranslatableJsxText = (node) => {
    const parent = node.parent;
    if (!ts.isJsxElement(parent)) {
      return false;
    }
    const elementName = getJsxElementName(parent.openingElement.tagName);
    return elementName !== null && JSX_TEXT_COMPONENTS.has(elementName);
  };

  const visit = (node) => {
    if (ts.isJsxText(node) && isTranslatableJsxText(node)) {
      addNormalized(keys, node.getText(sourceFile));
    }

    if (ts.isJsxAttribute(node) && node.initializer) {
      const attributeName = node.name.text;
      if (JSX_ATTRIBUTE_NAMES.has(attributeName)) {
        if (ts.isStringLiteral(node.initializer)) {
          addNormalized(keys, node.initializer.text);
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          maybeAddExpressionString(keys, node.initializer.expression);
        }
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const propertyName = getPropertyName(node.name);
      if (propertyName && OBJECT_PROPERTY_NAMES.has(propertyName)) {
        maybeAddExpressionString(keys, node.initializer);
      }
    }

    if (ts.isCallExpression(node)) {
      const callName = getCallName(node.expression);
      if (callName && STRING_CALLS.has(callName)) {
        const argumentIndex = STRING_CALLS.get(callName);
        const argument = argumentIndex === undefined ? undefined : node.arguments[argumentIndex];
        if (argument) {
          maybeAddExpressionString(keys, argument);
        }
      }
      if (callName && MESSAGE_DESCRIPTOR_CALLS.has(callName)) {
        const [descriptor] = node.arguments;
        if (descriptor) {
          extractFromMessageDescriptor(keys, descriptor);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

export function extractMessageKeys() {
  const keys = new Set();

  for (const directory of SOURCE_DIRS) {
    for (const filePath of walkFiles(directory)) {
      collectFileMessages(filePath, keys);
    }
  }

  return [...keys].toSorted((left, right) => left.localeCompare(right));
}

export function loadCatalogText(path) {
  return readFileSync(path, "utf8");
}

export function detectDuplicateCatalogKeys(catalogText) {
  const duplicates = new Set();
  const seen = new Set();
  const keyPattern = /"((?:\\"|[^"])*)"\s*:/g;

  for (const match of catalogText.matchAll(keyPattern)) {
    const key = match[1]?.replaceAll('\\"', '"') ?? "";
    if (seen.has(key)) {
      duplicates.add(key);
      continue;
    }
    seen.add(key);
  }

  return [...duplicates].toSorted((left, right) => left.localeCompare(right));
}

export function parseCatalog(path) {
  const text = loadCatalogText(path);
  return {
    duplicates: detectDuplicateCatalogKeys(text),
    messages: JSON.parse(text),
  };
}
