import { buildContractSchemaResolver, resolveSchemaObject } from "./contracts-resolver.mjs";

function firstStatusCode(operation) {
  if (!operation.expectedStatusText) {
    return operation.transportMethod === "requestRaw" ? "200" : "200";
  }
  return operation.expectedStatusText.replace(/[[\]\s]/gu, "").split(",")[0] ?? "200";
}

function ensureComponentSchema(components, name, schema) {
  if (!name || !schema || components.schemas[name]) {
    return;
  }
  components.schemas[name] = schema;
}

export async function buildOpenApiSpec(httpOperations) {
  const resolver = await buildContractSchemaResolver();
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Tyrum HTTP API",
      version: "generated",
    },
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  };

  for (const operation of httpOperations) {
    const pathItem = (spec.paths[operation.path] ??= {});
    if (operation.method === "ALL") {
      pathItem["x-tyrum-all-operation"] = {
        operationId: operation.id,
        summary: operation.summary,
        auth: operation.auth,
        scopes: operation.scopes,
      };
      continue;
    }
    const methodKey = operation.method.toLowerCase();
    const pathParameters = [];
    for (const parameter of operation.pathParameters ?? []) {
      const schema = await resolveSchemaObject(
        resolver,
        parameter.schemaName,
        `Path parameter "${parameter.name}"`,
      );
      ensureComponentSchema(spec.components, parameter.schemaName, schema);
      pathParameters.push({
        name: parameter.name,
        in: "path",
        required: true,
        schema:
          parameter.schemaName && spec.components.schemas[parameter.schemaName]
            ? { $ref: `#/components/schemas/${parameter.schemaName}` }
            : { type: "string" },
      });
    }

    const responseSchema = await resolveSchemaObject(
      resolver,
      operation.responseSchemaName,
      `Response for ${operation.id}`,
    );
    ensureComponentSchema(spec.components, operation.responseSchemaName, responseSchema);
    const statusCode = firstStatusCode(operation);
    const responses = {
      [statusCode]: {
        description: operation.summary,
        content:
          operation.transportMethod === "requestRaw"
            ? {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" },
                },
              }
            : {
                "application/json": {
                  schema:
                    operation.responseSchemaName &&
                    spec.components.schemas[operation.responseSchemaName]
                      ? { $ref: `#/components/schemas/${operation.responseSchemaName}` }
                      : { type: "object", additionalProperties: true },
                },
              },
      },
    };

    const operationObject = {
      operationId: operation.id,
      summary: operation.summary,
      tags: [operation.tag],
      parameters: [...pathParameters],
      responses,
      security: operation.auth === "public" ? [] : [{ bearerAuth: [] }],
    };

    if (operation.querySchemaName) {
      const querySchema = await resolveSchemaObject(
        resolver,
        operation.querySchemaName,
        `Query for ${operation.id}`,
      );
      ensureComponentSchema(spec.components, operation.querySchemaName, querySchema);
      operationObject.parameters.push({
        name: "query",
        in: "query",
        required: false,
        schema:
          operation.querySchemaName && spec.components.schemas[operation.querySchemaName]
            ? { $ref: `#/components/schemas/${operation.querySchemaName}` }
            : { type: "object", additionalProperties: true },
      });
    }

    if (operation.bodySchemaName) {
      const bodySchema = await resolveSchemaObject(
        resolver,
        operation.bodySchemaName,
        `Request body for ${operation.id}`,
      );
      ensureComponentSchema(spec.components, operation.bodySchemaName, bodySchema);
      operationObject.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema:
              operation.bodySchemaName && spec.components.schemas[operation.bodySchemaName]
                ? { $ref: `#/components/schemas/${operation.bodySchemaName}` }
                : { type: "object", additionalProperties: true },
          },
        },
      };
    }

    pathItem[methodKey] = operationObject;
  }

  return spec;
}

export async function buildAsyncApiSpec(wsCatalog) {
  const resolver = await buildContractSchemaResolver();
  const spec = {
    asyncapi: "2.6.0",
    info: {
      title: "Tyrum WebSocket API",
      version: "generated",
    },
    channels: {
      "/ws": {
        publish: {
          message: {
            oneOf: [],
          },
        },
        subscribe: {
          message: {
            oneOf: [],
          },
        },
      },
    },
    components: {
      schemas: {},
      messages: {},
    },
  };

  for (const request of wsCatalog.requests) {
    const requestSchema = await resolveSchemaObject(
      resolver,
      request.schemaName,
      `WebSocket request ${request.type}`,
    );
    ensureComponentSchema(spec.components, request.schemaName, requestSchema);
    spec.components.messages[request.schemaName] = {
      name: request.type,
      title: request.summary,
      payload: { $ref: `#/components/schemas/${request.schemaName}` },
    };

    const directionTarget =
      request.direction === "server_to_client"
        ? spec.channels["/ws"].subscribe.message.oneOf
        : spec.channels["/ws"].publish.message.oneOf;
    directionTarget.push({ $ref: `#/components/messages/${request.schemaName}` });

    for (const responseSchemaName of request.responseSchemaNames ?? []) {
      const responseSchema = await resolveSchemaObject(
        resolver,
        responseSchemaName,
        `WebSocket response ${request.type}`,
      );
      ensureComponentSchema(spec.components, responseSchemaName, responseSchema);
      spec.components.messages[responseSchemaName] = {
        name: request.type,
        title: `${request.type} response`,
        payload: { $ref: `#/components/schemas/${responseSchemaName}` },
      };
      spec.channels["/ws"].subscribe.message.oneOf.push({
        $ref: `#/components/messages/${responseSchemaName}`,
      });
    }
  }

  for (const event of wsCatalog.events) {
    const eventSchema = await resolveSchemaObject(
      resolver,
      event.schemaName,
      `WebSocket event ${event.type}`,
    );
    ensureComponentSchema(spec.components, event.schemaName, eventSchema);
    spec.components.messages[event.schemaName] = {
      name: event.type,
      title: event.summary,
      payload: { $ref: `#/components/schemas/${event.schemaName}` },
    };
    spec.channels["/ws"].subscribe.message.oneOf.push({
      $ref: `#/components/messages/${event.schemaName}`,
    });
  }

  return spec;
}

export function renderHttpDocs(httpOperations) {
  const sections = [
    "# API Reference",
    "",
    "<!-- GENERATED: pnpm api:generate -->",
    "",
    "This document is generated from the canonical gateway API manifest.",
    "",
    "Download machine-readable specs:",
    "- `/specs/openapi.json`",
    "- `/specs/asyncapi.json`",
    "",
    "## Table of Contents",
    "",
    "- [HTTP API](#http-api)",
    "- [WebSocket API](#websocket-api)",
    "",
    "## HTTP API",
    "",
  ];

  for (const operation of httpOperations) {
    sections.push(`#### ${operation.method} ${operation.path}`);
    sections.push("");
    if (operation.sdk) {
      sections.push(`- SDK operation: \`${operation.id}\``);
    }
    sections.push(`- Auth: ${operation.auth === "public" ? "Public" : "Required"}`);
    sections.push(
      `- Device scope: ${
        operation.scopes === null
          ? "n/a"
          : operation.scopes.length > 0
            ? operation.scopes.join(", ")
            : "none"
      }`,
    );
    if (operation.bodySchemaName) {
      sections.push(`- Request body schema: \`${operation.bodySchemaName}\``);
    }
    if ((operation.pathParameters ?? []).length > 0) {
      sections.push(
        `- Path params: ${operation.pathParameters
          .map((parameter) =>
            parameter.schemaName
              ? `\`${parameter.name}\` -> \`${parameter.schemaName}\``
              : `\`${parameter.name}\``,
          )
          .join(", ")}`,
      );
    }
    if (operation.querySchemaName) {
      sections.push(`- Query schema: \`${operation.querySchemaName}\``);
    }
    sections.push(
      `- Response schema: \`${
        operation.responseSchemaName ??
        (operation.transportMethod === "requestRaw" ? "raw-response" : "unknown")
      }\``,
    );
    sections.push("");
  }

  return sections.join("\n").trimEnd();
}

export function renderWsDocs(wsCatalog) {
  const sections = ["## WebSocket API", ""];
  for (const request of wsCatalog.requests) {
    sections.push(`#### \`${request.type}\``);
    sections.push("");
    sections.push(`- Direction: \`${request.direction}\``);
    sections.push(`- Request schema: \`${request.schemaName}\``);
    sections.push(
      `- Device scope: ${
        request.scopes === null
          ? "n/a"
          : request.scopes.length > 0
            ? request.scopes.join(", ")
            : "none"
      }`,
    );
    sections.push(
      `- Response schemas: ${
        request.responseSchemaNames && request.responseSchemaNames.length > 0
          ? request.responseSchemaNames.map((name) => `\`${name}\``).join(", ")
          : "none"
      }`,
    );
    sections.push("");
  }
  return sections.join("\n").trimEnd();
}
