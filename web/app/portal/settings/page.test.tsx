import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountSettingsPage from "./page";

describe("AccountSettingsPage", () => {
  const emptyProfilesResponse = { pam: null, pvp: null };
  let audioPlayMock: ReturnType<typeof vi.fn>;
  let audioPauseMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    audioPlayMock = vi.fn().mockResolvedValue(undefined);
    audioPauseMock = vi.fn();
    global.Audio = class {
      src = "";
      currentTime = 0;
      play = audioPlayMock;
      pause = audioPauseMock;
    } as unknown as typeof Audio;
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockFetch(emptyProfilesResponse)) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockFetch = (payload: unknown, init?: { ok?: boolean; status?: number }) => {
    const ok = init?.ok ?? true;
    const status = init?.status ?? (ok ? 200 : 500);

    return {
      ok,
      status,
      text: vi.fn().mockResolvedValue(JSON.stringify(payload ?? {})),
    } as unknown as Response;
  };

  it("renders the account settings header and description", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<AccountSettingsPage />);

    expect(
      screen.getByRole("heading", { name: "Account Settings", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Control the account lifecycle for your Tyrum workspace. Export archives help you verify that our automation respects consent before requesting deletion.",
      ),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  it("queues an export and surfaces a success toast", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockFetch(emptyProfilesResponse))
      .mockResolvedValue(
        mockFetch({
          status: "enqueued",
          task: { auditReference: "AUDIT-EXPORT-0001" },
        }),
      );

    render(<AccountSettingsPage />);

    await userEvent.click(screen.getByRole("button", { name: "Queue export" }));

    expect(fetchSpy).toHaveBeenCalledWith("/api/account/export", {
      method: "POST",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    await waitFor(() => {
      expect(screen.getByText(/Data export enqueued/)).toBeInTheDocument();
    });
  });

  it("surfaces an error toast when the deletion request fails", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockFetch(emptyProfilesResponse))
      .mockResolvedValue(
        mockFetch(
          {
            message: "Deletion currently unavailable.",
          },
          { ok: false, status: 502 },
        ),
      );

    render(<AccountSettingsPage />);

    await userEvent.click(screen.getByRole("button", { name: "Queue deletion" }));

    expect(fetchSpy).toHaveBeenCalledWith("/api/account/delete", {
      method: "POST",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Deletion currently unavailable.",
      );
    });
  });

  it("loads stored profiles into the settings forms", async () => {
    const storedProfiles = {
      pam: {
        profile_id: "pam-default",
        version: "pam-version-123",
        profile: {
          escalation_mode: "act_within_limits",
          auto_approve: {
            limit_minor_units: 2500,
            currency: "USD",
          },
        },
      },
      pvp: {
        profile_id: "pvp-default",
        version: "pvp-version-456",
        profile: {
          tone: "calm",
          verbosity: "thorough",
          initiative: "high",
          consent_style: "ask_once_per_vendor",
          emoji_gifs: "often",
          language: "en-US",
          voice: {
            voice_id: "alloy",
            pace: 0.7,
            pitch: 0.2,
            warmth: 0.5,
            pronunciation_dict: [
              { token: "Tyrum", pronounce: "Tie-rum" },
              { token: "AI", pronounce: "A I" },
            ],
          },
        },
      },
    };

    const fetchMock = vi.fn().mockResolvedValue(mockFetch(storedProfiles));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<AccountSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Escalation mode")).toHaveValue("act_within_limits");
    });

    expect(screen.getByLabelText("Auto-approve limit (minor units)")).toHaveValue(2500);
    expect(screen.getByLabelText("Auto-approve currency")).toHaveValue("USD");
    expect(screen.getByText("Current version: pam-version-123")).toBeInTheDocument();

    expect(screen.getByLabelText("Tone")).toHaveValue("calm");
    expect(screen.getByLabelText("Verbosity")).toHaveValue("thorough");
    expect(screen.getByLabelText("Initiative")).toHaveValue("high");
    expect(screen.getByLabelText("Consent style")).toHaveValue("ask_once_per_vendor");
    expect(screen.getByLabelText("Emoji & GIFs")).toHaveValue("often");
    expect(screen.getByLabelText("Preferred language")).toHaveValue("en-US");
    expect(screen.getByLabelText("Voice ID")).toHaveValue("alloy");
    expect(screen.getByLabelText("Voice pace")).toHaveValue(0.7);
    expect(screen.getByLabelText("Voice pitch")).toHaveValue(0.2);
    expect(screen.getByLabelText("Voice warmth")).toHaveValue(0.5);
    const tokenFields = screen.getAllByLabelText("Token");
    expect(tokenFields).toHaveLength(2);
    expect(tokenFields[0]).toHaveValue("Tyrum");
    expect(tokenFields[1]).toHaveValue("AI");
    const pronounceFields = screen.getAllByLabelText("Pronounce as");
    expect(pronounceFields).toHaveLength(2);
    expect(pronounceFields[0]).toHaveValue("Tie-rum");
    expect(pronounceFields[1]).toHaveValue("A I");
    expect(screen.getByText("Current version: pvp-version-456")).toBeInTheDocument();
  });

  it("allows adding and removing pronunciation overrides", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetch(emptyProfilesResponse));
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<AccountSettingsPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/profiles", expect.any(Object));
    });

    await user.click(screen.getByRole("button", { name: "Add pronunciation" }));
    const tokenFields = screen.getAllByLabelText("Token");
    const pronounceFields = screen.getAllByLabelText("Pronounce as");
    expect(tokenFields).toHaveLength(1);
    expect(pronounceFields).toHaveLength(1);

    await user.type(tokenFields[0], "Tyrum");
    await user.type(pronounceFields[0], "Tie-rum");
    expect(tokenFields[0]).toHaveValue("Tyrum");
    expect(pronounceFields[0]).toHaveValue("Tie-rum");

    await user.click(screen.getByRole("button", { name: /Remove pronunciation override/ }));
    expect(screen.queryAllByLabelText("Token")).toHaveLength(0);
  });

  it("surfaces an error when a pronunciation entry is incomplete", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetch(emptyProfilesResponse));
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<AccountSettingsPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/profiles", expect.any(Object));
    });

    await user.click(screen.getByRole("button", { name: "Add pronunciation" }));
    await user.type(screen.getByLabelText("Token"), "Tyrum");

    await user.click(screen.getByRole("button", { name: "Save persona profile" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Pronunciation entries must include both the token and the pronunciation.",
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/profiles/pvp",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("plays a voice preview when the API returns audio", async () => {
    const previewAudio = "ZmFrZS1hdWRpby1kYXRh";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetch({
          pam: null,
          pvp: {
            profile_id: "pvp-default",
            version: "pvp-version-200",
            profile: {
              voice: {
                voice_id: "nova",
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        mockFetch({
          audio_base64: previewAudio,
          format: "wav",
        }),
      );

    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<AccountSettingsPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/profiles", expect.any(Object));
    });

    await user.click(screen.getByRole("button", { name: "Preview voice" }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/profiles/pvp/preview",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(audioPlayMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("Playing voice preview.")).toBeInTheDocument();
    });
  });

  it("surfaces an error when the voice preview fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetch({
          pam: null,
          pvp: {
            profile_id: "pvp-default",
            version: "pvp-version-201",
            profile: {
              voice: {
                voice_id: "nova",
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        mockFetch(
          {
            message: "Preview unavailable.",
          },
          { ok: false, status: 502 },
        ),
      );

    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<AccountSettingsPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/profiles", expect.any(Object));
    });

    await user.click(screen.getByRole("button", { name: "Preview voice" }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/profiles/pvp/preview",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Preview unavailable.");
    });
    expect(audioPlayMock).not.toHaveBeenCalled();
  });

  it("submits autonomy preferences and surfaces success feedback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetch(emptyProfilesResponse))
      .mockResolvedValue(
        mockFetch({
          profile: {
            escalation_mode: "act_within_limits",
            auto_approve: { limit_minor_units: 3200, currency: "EUR" },
          },
          version: "pam-version-999",
        }),
      );

    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<AccountSettingsPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/profiles", expect.any(Object));
    });

    await user.selectOptions(
      screen.getByLabelText("Escalation mode"),
      "act_within_limits",
    );
    await user.clear(screen.getByLabelText("Auto-approve limit (minor units)"));
    await user.type(screen.getByLabelText("Auto-approve limit (minor units)"), "3200");
    await user.clear(screen.getByLabelText("Auto-approve currency"));
    await user.type(screen.getByLabelText("Auto-approve currency"), "EUR");

    await user.click(
      screen.getByRole("button", { name: "Save autonomy preferences" }),
    );

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/profiles/pam",
      expect.objectContaining({
        method: "PUT",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Autonomy preferences saved.")).toBeInTheDocument();
    });
    expect(screen.getByText("Current version: pam-version-999")).toBeInTheDocument();
  });

  it("surfaces an error when persona persistence fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetch(emptyProfilesResponse))
      .mockResolvedValue(
        mockFetch(
          { message: "Persona persistence failed." },
          { ok: false, status: 502 },
        ),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<AccountSettingsPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/profiles", expect.any(Object));
    });

    await user.selectOptions(screen.getByLabelText("Tone"), "calm");

    await user.click(screen.getByRole("button", { name: "Save persona profile" }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/profiles/pvp",
      expect.objectContaining({ method: "PUT" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Persona persistence failed.",
      );
    });
  });

  it("submits persona preferences and surfaces success feedback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetch(emptyProfilesResponse))
      .mockResolvedValue(
        mockFetch({
          profile: {
            tone: "energetic",
            verbosity: "balanced",
            initiative: "medium",
            consent_style: "ask_first",
            emoji_gifs: "sometimes",
            language: "fr-FR",
            voice: {
              voice_id: "nova",
              pace: 0.6,
              pitch: 0.3,
              warmth: 0.4,
              pronunciation_dict: [{ token: "Tyrum", pronounce: "Tie-rum" }],
            },
          },
          version: "pvp-version-321",
        }),
      );

    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<AccountSettingsPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/profiles", expect.any(Object));
    });

    await user.selectOptions(screen.getByLabelText("Tone"), "energetic");
    await user.selectOptions(screen.getByLabelText("Verbosity"), "balanced");
    await user.selectOptions(screen.getByLabelText("Initiative"), "medium");
    await user.selectOptions(screen.getByLabelText("Consent style"), "ask_first");
    await user.selectOptions(screen.getByLabelText("Emoji & GIFs"), "sometimes");
    await user.clear(screen.getByLabelText("Preferred language"));
    await user.type(screen.getByLabelText("Preferred language"), "fr-FR");
    await user.clear(screen.getByLabelText("Voice ID"));
    await user.type(screen.getByLabelText("Voice ID"), "nova");
    await user.clear(screen.getByLabelText("Voice pace"));
    await user.type(screen.getByLabelText("Voice pace"), "0.6");
    await user.clear(screen.getByLabelText("Voice pitch"));
    await user.type(screen.getByLabelText("Voice pitch"), "0.3");
    await user.clear(screen.getByLabelText("Voice warmth"));
    await user.type(screen.getByLabelText("Voice warmth"), "0.4");
    await user.click(screen.getByRole("button", { name: "Add pronunciation" }));
    await user.type(screen.getByLabelText("Token"), "Tyrum");
    await user.type(screen.getByLabelText("Pronounce as"), "Tie-rum");

    await user.click(screen.getByRole("button", { name: "Save persona profile" }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/profiles/pvp",
      expect.objectContaining({
        method: "PUT",
      }),
    );
    const [, requestInit] = fetchMock.mock.calls.at(-1) ?? [];
    const body = requestInit && requestInit.body ? JSON.parse(requestInit.body as string) : {};
    expect(body.profile.voice.pronunciation_dict).toEqual([
      { token: "Tyrum", pronounce: "Tie-rum" },
    ]);

    await waitFor(() => {
      expect(screen.getByText("Persona preferences saved.")).toBeInTheDocument();
    });
    expect(screen.getByText("Current version: pvp-version-321")).toBeInTheDocument();
  });
});
