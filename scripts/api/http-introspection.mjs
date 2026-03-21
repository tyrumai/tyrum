import { basename, extname, join, relative } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import ts from "typescript";
import {
  gatewayRoutesDir,
  httpGeneratedDir,
  httpSourceDir,
  HTTP_SOURCE_EXCLUDES,
  MANUAL_HTTP_ROUTE_ENTRIES,
  repoRoot,
} from "./paths.mjs";
import { manifestRouteKey, resolveHttpScopeEntry } from "./http-route-scope.mjs";
import {
  adjustGeneratedImportPath,
  createSourceFile,
  extractLiteralString,
  lowerFirst,
  pascalFromFile,
  resolvePathExpression,
  toWords,
  upperFirst,
} from "./source-utils.mjs";

function deriveTagFromGroup(groupName) {
  const words = toWords(groupName);
  if (!words) return "General";
  return words
    .split(/\s+/u)
    .map((word) => upperFirst(word))
    .join(" ");
}

function summarizeHttpOperation(groupName, methodName, method, pathTemplate) {
  const base = `${deriveTagFromGroup(groupName)} ${toWords(methodName)}`.trim();
  return `${method} ${pathTemplate} (${base})`;
}

function extractValidateCalls(bodyText) {
  const results = [];
  for (const match of bodyText.matchAll(/validateOrThrow\((\w+),\s*(\w+)/gu)) {
    const [, schemaName, variableName] = match;
    if (!schemaName || !variableName) continue;
    results.push({ schemaName, variableName });
  }
  return results;
}

function categorizeHttpParameters(input) {
  const { method, pathTemplate, validations } = input;
  const pathParameters = [];
  const querySchemas = [];
  let bodySchemaName;
  const placeholders = [...pathTemplate.matchAll(/\{([^}]+)\}/gu)]
    .map((match) => match[1])
    .filter(Boolean);

  for (const placeholder of placeholders) {
    const camelPlaceholder = placeholder.replace(/_([a-z])/gu, (_match, letter) =>
      letter.toUpperCase(),
    );
    const validation = validations.find(
      (entry) =>
        entry.variableName === placeholder ||
        entry.variableName === `parsed${upperFirst(placeholder)}` ||
        entry.variableName === `parsed${upperFirst(camelPlaceholder)}`,
    );
    pathParameters.push({ name: placeholder, schemaName: validation?.schemaName });
  }

  for (const validation of validations) {
    if (validation.variableName === "query" || validation.variableName === "parsedQuery") {
      querySchemas.push(validation.schemaName);
      continue;
    }
    if (
      validation.variableName === "input" ||
      validation.variableName === "body" ||
      validation.variableName === "parsedInput"
    ) {
      bodySchemaName = validation.schemaName;
    }
  }

  if (!bodySchemaName && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    const candidate = validations.find(
      (entry) => !pathParameters.some((param) => param.schemaName === entry.schemaName),
    );
    bodySchemaName = candidate?.schemaName;
  }

  return {
    pathParameters,
    querySchemaName: querySchemas.length > 0 ? querySchemas.at(-1) : undefined,
    bodySchemaName,
  };
}

function repairPathTemplate(pathTemplate, methodNode) {
  if (!pathTemplate.includes("{encodeURIComponent}") && !pathTemplate.includes("{String}")) {
    return pathTemplate;
  }
  const pathParamCandidates = methodNode.parameters
    .map((parameter) => parameter.name.getText())
    .filter((name) => !["input", "query", "options", "context"].includes(name));
  let candidateIndex = 0;
  return pathTemplate.replace(/\{(encodeURIComponent|String|param)\}/gu, () => {
    const replacement = pathParamCandidates[candidateIndex] ?? `param${candidateIndex + 1}`;
    candidateIndex += 1;
    return `{${replacement}}`;
  });
}

function findReturnObjectLiteral(functionDecl) {
  if (!functionDecl.body) return undefined;
  for (const statement of functionDecl.body.statements) {
    if (!ts.isReturnStatement(statement) || !statement.expression) continue;
    if (ts.isObjectLiteralExpression(statement.expression)) return statement.expression;
  }
  return undefined;
}

function findTransportCall(sourceFile, fileText, methodNode, bodyText) {
  let callExpression;
  function visit(node) {
    if (callExpression) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "transport" &&
      (node.expression.name.text === "request" || node.expression.name.text === "requestRaw")
    ) {
      callExpression = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  if (methodNode.body) {
    ts.forEachChild(methodNode.body, visit);
  }
  if (!callExpression) return undefined;
  const transportMethod = callExpression.expression.name.text;
  const configArg = callExpression.arguments[0];
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) return undefined;
  const propertyMap = new Map();
  for (const property of configArg.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
      propertyMap.set(property.name.text, property.initializer.getText(sourceFile));
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      propertyMap.set(property.name.text, property.name.text);
    }
  }
  const method = extractLiteralString(propertyMap.get("method")) ?? "GET";
  return {
    transportMethod,
    method,
    pathTemplate: resolvePathExpression(fileText, bodyText, propertyMap.get("path")) ?? "",
    responseSchemaName: propertyMap.get("response")?.replace(/,$/u, "").trim(),
    expectedStatusText: propertyMap.get("expectedStatus"),
  };
}

function buildHttpOperationRecord(sourceFile, filePath, fileText, apiName, methodNode) {
  const methodName = methodNode.name.getText(sourceFile);
  const bodyText = methodNode.body?.getText(sourceFile) ?? "";
  const transportCall = findTransportCall(sourceFile, fileText, methodNode, bodyText);
  if (!transportCall) return undefined;
  const repairedPathTemplate = repairPathTemplate(transportCall.pathTemplate, methodNode);
  const parameterInfo = categorizeHttpParameters({
    method: transportCall.method,
    pathTemplate: repairedPathTemplate,
    validations: extractValidateCalls(bodyText),
  });
  const authInfo = resolveHttpScopeEntry(transportCall.method, repairedPathTemplate);
  return {
    id: `${apiName}.${methodName}`,
    file: relative(repoRoot, filePath),
    sourceModuleBaseName: basename(filePath, ".ts"),
    apiName,
    methodName,
    tag: deriveTagFromGroup(apiName),
    method: transportCall.method,
    pathTemplate: repairedPathTemplate,
    summary: summarizeHttpOperation(
      apiName,
      methodName,
      transportCall.method,
      repairedPathTemplate,
    ),
    responseSchemaName: transportCall.responseSchemaName,
    expectedStatusText: transportCall.expectedStatusText,
    transportMethod: transportCall.transportMethod,
    auth: authInfo.auth,
    scopes: authInfo.scopes,
    pathParameters: parameterInfo.pathParameters,
    querySchemaName: parameterInfo.querySchemaName,
    bodySchemaName: parameterInfo.bodySchemaName,
  };
}

function collectHttpRuntimeModule(sourceFile, sourceText, entryName) {
  const runtimeImports = [];
  const helpers = [];
  const createFunctions = [];
  const createFunctionNames = [];
  const typeNames = new Set();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier.getText(sourceFile).slice(1, -1);
      const clause = statement.importClause;
      if (!clause) continue;
      const runtimeNamed = [];
      for (const specifier of clause.namedBindings?.elements ?? []) {
        if (specifier.isTypeOnly) continue;
        runtimeNamed.push(specifier.getText(sourceFile));
      }
      const defaultImport = clause.name?.getText(sourceFile);
      if (!defaultImport && runtimeNamed.length === 0) {
        continue;
      }
      const source = adjustGeneratedImportPath(moduleSpecifier);
      const namedPart = runtimeNamed.length > 0 ? `{ ${runtimeNamed.join(", ")} }` : "";
      const separator = defaultImport && namedPart ? ", " : "";
      runtimeImports.push(
        `import ${defaultImport ?? ""}${separator}${namedPart} from "${source}";`,
      );
      continue;
    }

    if (
      ts.isVariableStatement(statement) &&
      !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      helpers.push(statement.getText(sourceFile));
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const functionName = statement.name.text;
      if (functionName.startsWith("create") && functionName.endsWith("Api")) {
        const returnType = statement.type?.getText(sourceFile);
        if (returnType) {
          typeNames.add(returnType);
        }
        createFunctionNames.push(functionName);
        createFunctions.push(statement.getText(sourceFile));
        continue;
      }
      if (!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        helpers.push(statement.getText(sourceFile));
      }
    }
  }

  const moduleBaseName = basename(entryName, ".ts");
  const moduleBody = [...helpers, ...createFunctions].join("\n\n");
  const usesZodRuntime = /\bz\s*\./u.test(moduleBody);

  const filteredRuntimeImports = runtimeImports.filter((statement) => {
    if (!statement.includes('from "zod"')) {
      return true;
    }
    return usesZodRuntime;
  });
  const typeImport =
    typeNames.size > 0
      ? `import type { ${[...typeNames].toSorted().join(", ")} } from "../${moduleBaseName}.js";`
      : undefined;
  const imports = [...new Set(filteredRuntimeImports)];
  if (usesZodRuntime && !imports.some((statement) => statement.includes('from "zod"'))) {
    imports.push('import { z } from "zod";');
  }
  if (typeImport) {
    imports.push(typeImport);
  }

  const content = [
    "// GENERATED: pnpm api:generate",
    "",
    ...imports.toSorted(),
    "",
    ...helpers,
    ...createFunctions,
    "",
  ]
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n");

  return {
    sourceFile: relative(repoRoot, join(httpSourceDir, entryName)),
    generatedFile: relative(repoRoot, join(httpGeneratedDir, `${moduleBaseName}.generated.ts`)),
    moduleBaseName,
    createFunctionNames: createFunctionNames.toSorted(),
    content,
  };
}

function routeEntryKey(method, path) {
  return manifestRouteKey(method, path);
}

function normalizeRouteLiteral(rawPath) {
  return rawPath.replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
}

function isHonoTypeNode(typeNode) {
  if (!typeNode) return false;
  if (ts.isTypeReferenceNode(typeNode)) {
    return typeNode.typeName.getText() === "Hono";
  }
  return false;
}

function isHonoConstructor(node) {
  return (
    ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Hono"
  );
}

function extractRouteLiteral(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function extractLiteralRouteEntries(sourceFile, fileName) {
  const entries = [];
  const routeTargetNames = new Set();
  const routeMethods = new Set(["get", "post", "put", "patch", "delete", "all"]);

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (isHonoConstructor(node.initializer)) {
        routeTargetNames.add(node.name.text);
      }
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && isHonoTypeNode(node.type)) {
      routeTargetNames.add(node.name.text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const targetName = node.expression.expression.text;
      const methodName = node.expression.name.text;
      const literal = node.arguments[0] ? extractRouteLiteral(node.arguments[0]) : undefined;
      if (
        routeTargetNames.has(targetName) &&
        routeMethods.has(methodName) &&
        literal &&
        !literal.includes("${")
      ) {
        entries.push({
          method: methodName.toUpperCase(),
          path: normalizeRouteLiteral(literal),
          sourceFile: fileName,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return entries;
}

function alignPathParameters(routePath, pathParameters) {
  const routePlaceholders = [...routePath.matchAll(/\{([^}]+)\}/gu)]
    .map((match) => match[1])
    .filter(Boolean);
  if (routePlaceholders.length === 0 || pathParameters.length === 0) {
    return pathParameters;
  }
  return pathParameters.map((parameter, index) => ({
    ...parameter,
    name: routePlaceholders[index] ?? parameter.name,
  }));
}

function sortHttpOperations(entries) {
  return entries.toSorted((left, right) => {
    const leftKey = `${left.method} ${left.pathTemplate ?? left.path}`;
    const rightKey = `${right.method} ${right.pathTemplate ?? right.path}`;
    return leftKey.localeCompare(rightKey);
  });
}

export async function extractHttpCatalog() {
  const entries = await readdir(httpSourceDir, { withFileTypes: true });
  const operations = [];
  const runtimeModules = [];

  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".ts" || HTTP_SOURCE_EXCLUDES.has(entry.name)) {
      continue;
    }
    const filePath = join(httpSourceDir, entry.name);
    const sourceText = await readFile(filePath, "utf8");
    const sourceFile = createSourceFile(filePath, sourceText);
    runtimeModules.push(collectHttpRuntimeModule(sourceFile, sourceText, entry.name));

    for (const statement of sourceFile.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
      const functionName = statement.name.text;
      if (!functionName.startsWith("create") || !functionName.endsWith("Api")) continue;
      const apiName = lowerFirst(functionName.slice("create".length, -3));
      const objectLiteral = findReturnObjectLiteral(statement);
      if (!objectLiteral) continue;
      for (const property of objectLiteral.properties) {
        if (!ts.isMethodDeclaration(property)) continue;
        const record = buildHttpOperationRecord(
          sourceFile,
          filePath,
          sourceText,
          apiName,
          property,
        );
        if (record) operations.push(record);
      }
    }
  }

  const routeFiles = await readdir(gatewayRoutesDir, { withFileTypes: true });
  const manifestOperations = new Map();

  for (const routeFile of routeFiles) {
    if (!routeFile.isFile() || extname(routeFile.name) !== ".ts") continue;
    const filePath = join(gatewayRoutesDir, routeFile.name);
    const sourceText = await readFile(filePath, "utf8");
    const sourceFile = createSourceFile(filePath, sourceText);
    for (const entry of extractLiteralRouteEntries(sourceFile, routeFile.name)) {
      manifestOperations.set(routeEntryKey(entry.method, entry.path), {
        id: `${pascalFromFile(routeFile.name)}.${entry.method}.${entry.path}`,
        file: relative(repoRoot, filePath),
        tag: deriveTagFromGroup(basename(routeFile.name, ".ts")),
        summary: `${entry.method} ${entry.path}`,
        method: entry.method,
        path: entry.path,
        auth: resolveHttpScopeEntry(entry.method, entry.path).auth,
        scopes: resolveHttpScopeEntry(entry.method, entry.path).scopes,
        sdk: null,
      });
    }
  }

  for (const entry of MANUAL_HTTP_ROUTE_ENTRIES) {
    manifestOperations.set(routeEntryKey(entry.method, entry.path), {
      id: `${pascalFromFile(entry.sourceFile)}.${entry.method}.${entry.path}`,
      file: `packages/gateway/src/routes/${entry.sourceFile}`,
      tag: deriveTagFromGroup(basename(entry.sourceFile, ".ts")),
      summary: `${entry.method} ${entry.path}`,
      method: entry.method,
      path: entry.path,
      auth: resolveHttpScopeEntry(entry.method, entry.path).auth,
      scopes: resolveHttpScopeEntry(entry.method, entry.path).scopes,
      sdk: null,
    });
  }

  for (const operation of operations) {
    const existing = manifestOperations.get(
      routeEntryKey(operation.method, operation.pathTemplate),
    );
    const routePath = existing?.path ?? operation.pathTemplate;
    manifestOperations.set(routeEntryKey(operation.method, operation.pathTemplate), {
      ...existing,
      ...operation,
      path: routePath,
      pathTemplate: routePath,
      pathParameters: alignPathParameters(routePath, operation.pathParameters),
      sdk: {
        apiName: operation.apiName,
        factoryName: `create${upperFirst(operation.apiName)}Api`,
        generatedModuleBaseName: operation.sourceModuleBaseName,
      },
    });
  }

  return {
    operations: sortHttpOperations([...manifestOperations.values()]),
    runtimeModules: runtimeModules.toSorted((a, b) =>
      a.moduleBaseName.localeCompare(b.moduleBaseName),
    ),
  };
}
