// @vitest-environment jsdom

import type { NodeInventoryEntry } from "@tyrum/contracts";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationProfileCard } from "../../src/components/pages/admin-http-location-sections.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";
import {
  cleanupAdminHttpPage,
  click,
  clickAndFlush,
  createAdminHttpTestCore,
  flush,
  getByTestId,
  getLabeledInput,
  getLabeledSelect,
  jsonResponse,
  openLocationTab,
  renderAdminHttpConfigurePage,
  setSelectValue,
} from "./admin-page.http.test-support.js";

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function stubLocationFetch() {
  const state = {
    profile: {
      primary_node_id: "mobile-node-1",
      poi_provider_key: "osm_overpass",
      updated_at: "2026-03-01T00:00:00.000Z",
    },
    places: [
      {
        place_id: "place-home",
        name: "Home",
        latitude: 52.3676,
        longitude: 4.9041,
        radius_m: 100,
        tags: ["home"],
        source: "manual",
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
      },
    ],
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = getRequestUrl(input);
    const method = init?.method ?? "GET";
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-elevated-token");

    if (method === "GET" && url === "http://example.test/location/profile") {
      return jsonResponse({ status: "ok", profile: state.profile });
    }
    if (method === "PATCH" && url === "http://example.test/location/profile") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string | null>;
      state.profile = {
        primary_node_id: body["primary_node_id"] ?? null,
        poi_provider_key: body["poi_provider_key"] ?? null,
        updated_at: "2026-03-01T00:00:30.000Z",
      };
      return jsonResponse({ status: "ok", profile: state.profile });
    }
    if (method === "GET" && url === "http://example.test/location/places") {
      return jsonResponse({ status: "ok", places: state.places });
    }
    if (method === "POST" && url === "http://example.test/location/places") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const place = {
        place_id: `place-${state.places.length + 1}`,
        name: String(body["name"]),
        latitude: Number(body["latitude"]),
        longitude: Number(body["longitude"]),
        radius_m: Number(body["radius_m"]),
        tags: Array.isArray(body["tags"]) ? (body["tags"] as string[]) : [],
        source: "manual",
        created_at: "2026-03-01T00:01:00.000Z",
        updated_at: "2026-03-01T00:01:00.000Z",
      };
      state.places = [...state.places, place];
      return jsonResponse({ status: "ok", place }, 201);
    }
    if (method === "DELETE" && url.startsWith("http://example.test/location/places/")) {
      const placeId = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
      state.places = state.places.filter((place) => place.place_id !== placeId);
      return jsonResponse({ status: "ok", place_id: placeId, deleted: true });
    }

    throw new Error(`Unhandled fetch request: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP) location", () => {
  it("keeps primary node options distinguishable when labels are missing", () => {
    const nodes: NodeInventoryEntry[] = [
      {
        node_id: "alpha-node",
        connected: true,
        paired_status: "approved",
        attached_to_requested_conversation: false,
        capabilities: [],
      },
      {
        node_id: "beta-node",
        label: "Named node",
        connected: true,
        paired_status: "approved",
        attached_to_requested_conversation: false,
        capabilities: [],
      },
      {
        node_id: "gamma-node",
        connected: true,
        paired_status: "approved",
        attached_to_requested_conversation: false,
        capabilities: [],
      },
    ];
    const { container, root } = renderIntoDocument(
      React.createElement(LocationProfileCard, {
        busyKey: null,
        loading: false,
        nodes,
        profile: null,
        profileDirty: false,
        profileDraft: {
          primaryNodeId: "",
          poiProviderKey: "",
        },
        onDraftChange: () => {},
        onRefresh: () => {},
        onSave: () => {},
      }),
    );

    try {
      const options = Array.from(getLabeledSelect(container, "Primary tracked node").options).map(
        (option) => option.text,
      );
      expect(options).toEqual([
        "No primary node assigned",
        "alpha-node",
        "Named node (beta-node)",
        "gamma-node",
      ]);
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("renders the location tab with saved places and profile settings", async () => {
    const { core } = createAdminHttpTestCore();
    stubLocationFetch();

    const page = renderAdminHttpConfigurePage(core);
    await openLocationTab(page.container);

    expect(page.container.querySelector("[data-testid='admin-http-location']")).not.toBeNull();
    expect(page.container.textContent).toContain("Location profile");
    expect(page.container.textContent).toContain("Home");
    expect(getLabeledSelect(page.container, "Primary tracked node").value).toBe("mobile-node-1");
    expect(getLabeledSelect(page.container, "POI provider").value).toBe("osm_overpass");

    cleanupAdminHttpPage(page);
  });

  it("saves the location profile through the elevated HTTP client", async () => {
    const { core } = createAdminHttpTestCore();
    const { fetchMock } = stubLocationFetch();

    const page = renderAdminHttpConfigurePage(core);
    await openLocationTab(page.container);

    setSelectValue(getLabeledSelect(page.container, "Primary tracked node"), "mobile-node-2");
    setSelectValue(getLabeledSelect(page.container, "POI provider"), "osm_overpass");
    await flush();
    await clickAndFlush(getByTestId<HTMLButtonElement>(page.container, "location-profile-save"));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://example.test/location/profile",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          primary_node_id: "mobile-node-2",
          poi_provider_key: "osm_overpass",
        }),
      }),
    );

    cleanupAdminHttpPage(page);
  });

  it("creates a saved place from the location tab", async () => {
    const { core } = createAdminHttpTestCore();
    const { fetchMock } = stubLocationFetch();

    const page = renderAdminHttpConfigurePage(core);
    await openLocationTab(page.container);

    act(() => {
      setNativeValue(getLabeledInput(page.container, "Place name"), "Warehouse");
      setNativeValue(getLabeledInput(page.container, "Tags"), "logistics, store");
      setNativeValue(getLabeledInput(page.container, "Latitude"), "52.1000");
      setNativeValue(getLabeledInput(page.container, "Longitude"), "4.3000");
      setNativeValue(getLabeledInput(page.container, "Radius (m)"), "180");
    });
    await flush();
    await clickAndFlush(getByTestId<HTMLButtonElement>(page.container, "location-place-save"));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://example.test/location/places",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Warehouse",
          latitude: 52.1,
          longitude: 4.3,
          radius_m: 180,
          tags: ["logistics", "store"],
        }),
      }),
    );
    expect(page.container.textContent).toContain("Warehouse");

    cleanupAdminHttpPage(page);
  });

  it("deletes a saved place after confirmation", async () => {
    const { core } = createAdminHttpTestCore();
    const { fetchMock } = stubLocationFetch();

    const page = renderAdminHttpConfigurePage(core);
    await openLocationTab(page.container);

    click(getByTestId<HTMLButtonElement>(page.container, "location-place-delete-place-home"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://example.test/location/places/place-home",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(page.container.textContent).not.toContain("Home");

    cleanupAdminHttpPage(page);
  });

  it("opens the admin access dialog before saving the profile when mutations are unavailable", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    core.elevatedModeStore.exit();

    const page = renderAdminHttpConfigurePage(core);
    await openLocationTab(page.container);

    setSelectValue(getLabeledSelect(page.container, "Primary tracked node"), "mobile-node-2");
    await flush();
    await clickAndFlush(getByTestId<HTMLButtonElement>(page.container, "location-profile-save"));

    expect(document.querySelector("[data-testid='elevated-mode-dialog']")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    cleanupAdminHttpPage(page);
  });

  it("opens the admin access dialog before creating a place when mutations are unavailable", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    core.elevatedModeStore.exit();

    const page = renderAdminHttpConfigurePage(core);
    await openLocationTab(page.container);

    act(() => {
      setNativeValue(getLabeledInput(page.container, "Place name"), "Warehouse");
      setNativeValue(getLabeledInput(page.container, "Tags"), "logistics, store");
      setNativeValue(getLabeledInput(page.container, "Latitude"), "52.1000");
      setNativeValue(getLabeledInput(page.container, "Longitude"), "4.3000");
      setNativeValue(getLabeledInput(page.container, "Radius (m)"), "180");
    });
    await flush();
    await clickAndFlush(getByTestId<HTMLButtonElement>(page.container, "location-place-save"));

    expect(document.querySelector("[data-testid='elevated-mode-dialog']")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    cleanupAdminHttpPage(page);
  });

  it("opens the admin access dialog before deleting a place when mutations are unavailable", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    core.elevatedModeStore.exit();

    const page = renderAdminHttpConfigurePage(core);
    await openLocationTab(page.container);

    click(getByTestId<HTMLButtonElement>(page.container, "location-place-delete-place-home"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(document.querySelector("[data-testid='elevated-mode-dialog']")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    cleanupAdminHttpPage(page);
  });
});
