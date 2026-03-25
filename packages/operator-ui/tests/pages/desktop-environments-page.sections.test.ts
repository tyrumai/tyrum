// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import {
  DesktopEnvironmentHostsCard,
  DesktopEnvironmentListCard,
  type DesktopEnvironment,
  type DesktopEnvironmentHost,
} from "../../src/components/pages/desktop-environments-page.sections.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Desktop environment sections", () => {
  it("renders host and environment errors in bounded raw-output blocks", () => {
    const host: DesktopEnvironmentHost = {
      host_id: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      docker_available: false,
      healthy: false,
      last_seen_at: null,
      last_error:
        "Command failed: docker info\nCannot connect to the Docker daemon at unix:///tmp/docker.sock.",
    };
    const environment: DesktopEnvironment = {
      environment_id: "env-1",
      host_id: host.host_id,
      label: "Research desktop",
      image_ref: "registry.example.test/desktop@sha256:1234",
      managed_kind: "docker",
      status: "error",
      desired_running: true,
      node_id: null,
      last_seen_at: null,
      last_error: "Container startup failed\nstderr: port bind rejected by runtime policy.",
      created_at: "2026-03-10T12:00:00.000Z",
      updated_at: "2026-03-10T12:00:00.000Z",
    };
    const testRoot = renderIntoDocument(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(DesktopEnvironmentHostsCard, { hosts: [host] }),
        React.createElement(DesktopEnvironmentListCard, {
          environments: [environment],
          hostById: { [host.host_id]: host },
          selectedEnvironmentId: null,
          onSelect: () => {},
        }),
      ),
    );

    const hostErrorBlock = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="desktop-host-error-host-1"]',
    );
    expect(hostErrorBlock?.tagName).toBe("PRE");
    expect(hostErrorBlock?.textContent).toBe(host.last_error);
    expect(hostErrorBlock?.className).toContain("max-h-40");
    expect(hostErrorBlock?.className).toContain("overflow-auto");
    expect(hostErrorBlock?.className).toContain("whitespace-pre");
    expect(hostErrorBlock?.className).toContain("font-mono");

    const environmentErrorBlock = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="desktop-environment-error-env-1"]',
    );
    expect(environmentErrorBlock?.tagName).toBe("PRE");
    expect(environmentErrorBlock?.textContent).toBe(environment.last_error);
    expect(environmentErrorBlock?.className).toContain("max-h-40");
    expect(environmentErrorBlock?.className).toContain("overflow-auto");
    expect(environmentErrorBlock?.className).toContain("whitespace-pre");
    expect(environmentErrorBlock?.className).toContain("font-mono");

    cleanupTestRoot(testRoot);
  });
});
