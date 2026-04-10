import { afterEach, describe, expect, it } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { BENCHMARK_MERCHANT_SITE_PATH, BENCHMARK_PUBLIC_BASE_URL_PATH } from "@tyrum/contracts";
import { createTestApp } from "./helpers.js";

describe("benchmark fixture routes", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    if (container) {
      await container.db.close();
      container = undefined;
    }
  });

  it("serves the benchmark merchant site without authentication", async () => {
    const appState = await createTestApp();
    container = appState.container;

    const response = await appState.requestUnauthenticated(BENCHMARK_MERCHANT_SITE_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("Benchmark Pizza Checkout");
    expect(html).toContain("Place Order");
    expect(html).toContain("BP-20260410-0001");
  });

  it("publishes the configured public base URL without authentication", async () => {
    const appState = await createTestApp({
      deploymentConfig: {
        server: {
          publicBaseUrl: "https://desktop-ron.tail5b753a.ts.net",
        },
      },
    });
    container = appState.container;

    const response = await appState.requestUnauthenticated(BENCHMARK_PUBLIC_BASE_URL_PATH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      public_base_url: "https://desktop-ron.tail5b753a.ts.net",
    });
  });
});
