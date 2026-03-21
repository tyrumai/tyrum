import ts from "typescript";

export function lowerFirst(value) {
  return value.length > 0 ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

export function upperFirst(value) {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

export function toWords(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
}

export function pascalFromFile(filename) {
  return filename
    .replace(/\.[^.]+$/u, "")
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map((part) => upperFirst(part))
    .join("");
}

export function createSourceFile(filePath, sourceText) {
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function extractLiteralString(valueText) {
  if (!valueText) return undefined;
  if (
    (valueText.startsWith('"') && valueText.endsWith('"')) ||
    (valueText.startsWith("'") && valueText.endsWith("'"))
  ) {
    return valueText.slice(1, -1);
  }
  if (valueText.startsWith("`") && valueText.endsWith("`")) {
    return valueText.slice(1, -1);
  }
  return undefined;
}

export function findHelperFunctionText(fileText, functionName) {
  const signature = new RegExp(`function\\s+${functionName}\\s*\\(`, "u");
  const match = signature.exec(fileText);
  if (!match) return undefined;
  const braceStart = fileText.indexOf("{", match.index);
  if (braceStart < 0) return undefined;
  let depth = 0;
  for (let index = braceStart; index < fileText.length; index += 1) {
    const char = fileText[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return fileText.slice(match.index, index + 1);
      }
    }
  }
  return undefined;
}

export function normalizePathTemplate(rawPath, variableMap = new Map()) {
  if (!rawPath) return rawPath;
  const templated = rawPath.replace(/\$\{([^}]+)\}/gu, (_match, inner) => {
    const cleaned = inner
      .replace(/encodeURIComponent\(/gu, "")
      .replace(/String\(/gu, "")
      .replace(/[()]/gu, "")
      .trim();
    const candidate = variableMap.get(cleaned) ?? cleaned.split(".").at(-1) ?? "param";
    return `{${candidate}}`;
  });
  return templated.replace(
    /\{parsed([A-Z][^}]+)\}/gu,
    (_match, suffix) => `{${lowerFirst(suffix)}}`,
  );
}

export function resolveHelperPath(fileText, functionName, callArgNames) {
  const functionText = findHelperFunctionText(fileText, functionName);
  if (!functionText) return undefined;
  const signatureMatch = functionText.match(
    new RegExp(`function\\s+${functionName}\\s*\\(([^)]*)\\)`, "u"),
  );
  const paramNames =
    signatureMatch?.[1]
      ?.split(",")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => segment.split(":")[0]?.trim())
      .filter(Boolean) ?? [];
  const variableMap = new Map();
  for (const match of functionText.matchAll(
    /const\s+(\w+)\s*=\s*validateOrThrow\([^,]+,\s*(\w+),/gu,
  )) {
    const [, localName, originalName] = match;
    if (localName && originalName) {
      variableMap.set(localName, originalName);
    }
  }
  const returnMatch = functionText.match(/return\s+(`[^`]+`|"[^"]+"|'[^']+')/u);
  const rawReturn = extractLiteralString(returnMatch?.[1]);
  if (!rawReturn) return undefined;
  let resolved = normalizePathTemplate(rawReturn, variableMap);
  paramNames.forEach((paramName, index) => {
    const callArg = callArgNames[index];
    if (!paramName || !callArg) return;
    resolved = resolved.replaceAll(`{${paramName}}`, `{${callArg}}`);
  });
  return resolved;
}

export function resolvePathExpression(fileText, bodyText, pathValueText) {
  if (!pathValueText) return undefined;
  const literal = extractLiteralString(pathValueText);
  if (literal) {
    const expandedHelpers = literal.replace(
      /\$\{(\w+)\(([^}]*)\)\}/gu,
      (_match, functionName, argsText) => {
        const callArgNames = argsText
          .split(",")
          .map((segment) => segment.trim())
          .filter(Boolean);
        return resolveHelperPath(fileText, functionName, callArgNames) ?? `{${functionName}}`;
      },
    );
    return normalizePathTemplate(expandedHelpers);
  }

  const identifierMatch = pathValueText.match(/^([A-Za-z_]\w*)$/u);
  if (identifierMatch) {
    const [, identifier] = identifierMatch;
    const assignmentMatch = bodyText.match(
      new RegExp(
        String.raw`const\s+${identifier}\s*=\s*([` +
          "`" +
          String.raw`][^` +
          "`" +
          String.raw`]*[` +
          "`" +
          String.raw`]|"[^"]+"|'[^']+')`,
        "u",
      ),
    );
    const assignedLiteral = extractLiteralString(assignmentMatch?.[1]);
    if (assignedLiteral) return normalizePathTemplate(assignedLiteral);
  }

  const pairingPathMatch = pathValueText.match(/^pairingPath\("(\w+)",\s*(\w+)\)$/u);
  if (pairingPathMatch) {
    return `/pairings/{${pairingPathMatch[2]}}/${pairingPathMatch[1]}`;
  }

  const helperCallMatch = pathValueText.match(/^(\w+)\(([^)]*)\)$/u);
  if (helperCallMatch) {
    const [, functionName, argsText] = helperCallMatch;
    const callArgNames = argsText
      .split(",")
      .map((segment) => segment.trim())
      .filter(Boolean);
    return resolveHelperPath(fileText, functionName, callArgNames);
  }

  return undefined;
}

export function stableJsonStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function adjustGeneratedImportPath(specifier) {
  if (!specifier.startsWith("./")) {
    return specifier;
  }
  return `.${specifier}`;
}
