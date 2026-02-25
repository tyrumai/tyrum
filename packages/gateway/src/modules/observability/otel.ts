import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export interface OtelRuntime {
  enabled: boolean;
  shutdown: () => Promise<void>;
}

function resolveOtelTracesEndpoint(): string | undefined {
  const explicit = process.env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"]?.trim();
  if (explicit) return explicit;

  const base = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]?.trim();
  if (!base) return undefined;
  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalized}/v1/traces`;
}

export async function maybeStartOtel(opts: {
  serviceName: string;
  serviceVersion: string;
  instanceId?: string;
}): Promise<OtelRuntime> {
  const enabled =
    process.env["TYRUM_OTEL_ENABLED"] === "1" ||
    Boolean(process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]) ||
    Boolean(process.env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"]);

  if (!enabled) {
    return {
      enabled: false,
      shutdown: async () => undefined,
    };
  }

  const tracesUrl = resolveOtelTracesEndpoint();

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: opts.serviceName,
      [ATTR_SERVICE_VERSION]: opts.serviceVersion,
      "tyrum.instance_id": opts.instanceId,
    }),
    traceExporter: new OTLPTraceExporter(tracesUrl ? { url: tracesUrl } : {}),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  await sdk.start();

  return {
    enabled: true,
    shutdown: async () => sdk.shutdown(),
  };
}
