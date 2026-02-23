import { Hono, type Context } from "hono";
import { setCookie } from "hono/cookie";
import type { ApprovalDal } from "../modules/approval/dal.js";
import type { MemoryDal } from "../modules/memory/dal.js";
import type { WatcherProcessor } from "../modules/watcher/processor.js";
import type { CanvasDal } from "../modules/canvas/dal.js";
import type { Playbook } from "@tyrum/schemas";
import type { PlaybookRunner } from "../modules/playbook/runner.js";
import { APP_PATH_PREFIX, matchesPathPrefixSegment } from "../app-path.js";
import {
  buildAuditTaskResponse,
  getPlanTimeline,
  listIntegrations,
  previewVoice,
  readProfiles,
  savePamProfile,
  savePvpProfile,
  setIntegrationPreference,
} from "../modules/web/local-store.js";
import {
  persistConsent,
  persistOperatingMode,
  snapshotConsent,
} from "../modules/web/consent-store.js";

export interface WebUiDeps {
  approvalDal: ApprovalDal;
  memoryDal: MemoryDal;
  watcherProcessor: WatcherProcessor;
  canvasDal: CanvasDal;
  playbooks: Playbook[];
  playbookRunner: PlaybookRunner;
  isLocalOnly: boolean;
}

const BASE_STYLE = `
:root {
  color-scheme: dark;
  --bg: #000;
  --bg-subtle: #0a0a0a;
  --card: #111;
  --text: #ededed;
  --muted: #888;
  --border: #1a1a1a;
  --primary: #6366f1;
  --primary-dim: rgba(99, 102, 241, 0.12);
  --success: #22c55e;
  --danger: #ef4444;
}
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; }
body {
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
::selection { background: rgba(99, 102, 241, 0.3); }
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
.layout { display: flex; height: 100vh; }
.sidebar {
  border-right: 1px solid var(--border);
  background: var(--bg-subtle);
  width: 200px;
  min-height: 100vh;
  padding: 16px 0;
  color: var(--muted);
  display: flex;
  flex-direction: column;
}
.brand {
  font-size: 18px;
  font-weight: 700;
  padding: 0 16px 16px;
  border-bottom: 1px solid var(--border);
  margin: 0 0 8px;
  color: #fff;
}
.brand-sub {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
  padding: 0 16px 12px;
  margin: 0;
}
.nav { display: flex; flex-direction: column; }
.nav a {
  display: block;
  padding: 10px 16px;
  border-left: 3px solid transparent;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 400;
  transition: background 0.15s, color 0.15s;
  user-select: none;
}
.nav a:hover { background: rgba(255, 255, 255, 0.03); }
.nav a.active {
  background: var(--primary-dim);
  border-left-color: var(--primary);
  color: #fff;
  font-weight: 600;
}
.main {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}
.page-header { margin-bottom: 18px; }
.page-header p { color: var(--muted); margin: 6px 0 0; }
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
}
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
h1 { margin: 0 0 20px; font-size: 22px; line-height: 1.15; font-weight: 700; }
h2 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
label[for] {
  display: block;
  margin: 10px 0 4px;
  font-weight: 600;
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
label:not([for]) {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 10px 0 4px;
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
}
label:not([for]) input { margin-top: 2px; }
input, textarea, select, button { font: inherit; }
input, textarea, select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-subtle);
  color: var(--text);
  font-size: 14px;
}
input[type="checkbox"], input[type="radio"] {
  width: auto;
  padding: 0;
  accent-color: var(--primary);
}
input:focus, textarea:focus, select:focus {
  outline: 2px solid rgba(99, 102, 241, 0.4);
  outline-offset: 1px;
}
textarea {
  min-height: 80px;
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  resize: vertical;
}
button {
  border: 1px solid transparent;
  background: var(--primary);
  color: #fff;
  border-radius: 6px;
  padding: 8px 20px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}
button:hover { filter: brightness(0.95); }
button.secondary {
  background: transparent;
  color: var(--text);
  border-color: var(--border);
}
button.ghost {
  background: var(--primary-dim);
  color: var(--primary);
  border-color: rgba(99, 102, 241, 0.35);
}
button.danger { background: var(--danger); }
button:disabled { opacity: 0.65; cursor: not-allowed; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.kv { display: grid; grid-template-columns: 170px 1fr; gap: 8px 12px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; border-bottom: 1px solid var(--border); padding: 8px 6px; vertical-align: top; }
th { color: var(--muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
code, pre {
  background: var(--bg-subtle);
  border-radius: 6px;
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
}
code { padding: 1px 4px; }
pre { padding: 10px; overflow: auto; border: 1px solid var(--border); }
.notice { padding: 10px 12px; border-radius: 8px; margin-bottom: 14px; border: 1px solid; }
.notice.ok { background: rgba(34, 197, 94, 0.12); color: #bbf7d0; border-color: rgba(34, 197, 94, 0.5); }
.notice.error { background: rgba(239, 68, 68, 0.12); color: #fecaca; border-color: rgba(239, 68, 68, 0.5); }
.muted { color: var(--muted); }
.inline { display: inline; }
.settings-columns { display: grid; gap: 14px; grid-template-columns: 1fr; }
.settings-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; background: var(--primary-dim); color: var(--primary); font-weight: 600; }
.dictionary-list { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 10px; }
.dictionary-row {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: var(--bg-subtle);
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 10px;
  align-items: end;
}
.dictionary-row button { white-space: nowrap; }
.helper { font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 8px; }
.calibration-shell { max-width: 860px; }
.calibration-top { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 12px; }
.calibration-meta { color: var(--muted); font-size: 13px; }
.calibration-options { display: grid; gap: 10px; margin-top: 10px; }
.option-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: var(--bg-subtle);
}
.option-card strong { display: block; margin-bottom: 4px; }
.onboarding-stepper { list-style: none; margin: 0 0 12px; padding: 0; display: flex; gap: 8px; flex-wrap: wrap; }
.onboarding-stepper li {
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--muted);
}
.onboarding-stepper li.active { background: var(--primary-dim); border-color: rgba(99, 102, 241, 0.35); color: #fff; font-weight: 600; }
@media (max-width: 960px) {
  .layout { flex-direction: column; height: auto; min-height: 100vh; }
  .sidebar { border-right: none; border-bottom: 1px solid var(--border); width: auto; min-height: auto; }
  .main { padding: 18px; }
}
@media (max-width: 760px) {
  .dictionary-row { grid-template-columns: 1fr; }
  .kv { grid-template-columns: 1fr; }
}
`;

const PAM_ESCALATION_OPTIONS = [
  "ask_first",
  "ask_once_per_vendor",
  "act_within_limits",
] as const;

const PVP_TONE_OPTIONS = ["calm", "energetic", "witty", "formal", "playful"] as const;
const PVP_VERBOSITY_OPTIONS = ["terse", "balanced", "thorough"] as const;
const PVP_INITIATIVE_OPTIONS = ["low", "medium", "high"] as const;
const PVP_CONSENT_OPTIONS = [
  "ask_first",
  "ask_once_per_vendor",
  "act_within_limits",
] as const;
const PVP_EMOJI_OPTIONS = ["never", "sometimes", "often"] as const;

const PRONUNCIATION_MAX_ENTRIES = 32;
const PRONUNCIATION_MAX_LENGTH = 128;
const AUTH_COOKIE_NAME = "tyrum_admin_token";
const AUTH_QUERY_PARAM = "token";

// Inline scripts are intentionally minimal; onboarding/settings are server-rendered.

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatJson(value: unknown): string {
  return esc(JSON.stringify(value, null, 2));
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return esc(date.toLocaleString());
}

function messageBanner(search: URLSearchParams): string {
  const msg = search.get("msg");
  if (!msg) return "";
  const tone = search.get("tone") === "error" ? "error" : "ok";
  return `<p class="notice ${tone}">${esc(msg)}</p>`;
}

function getAuthQueryToken(search: URLSearchParams): string | undefined {
  const token = search.get(AUTH_QUERY_PARAM)?.trim();
  return token ? token : undefined;
}

function withAuthToken(path: string, search: URLSearchParams): string {
  const token = getAuthQueryToken(search);
  if (!token) {
    return path;
  }

  let url: URL;
  try {
    url = new URL(path, "http://tyrum.local");
  } catch {
    return path;
  }

  if (!matchesPathPrefixSegment(url.pathname, APP_PATH_PREFIX)) {
    return path;
  }

  if (!url.searchParams.has(AUTH_QUERY_PARAM)) {
    url.searchParams.set(AUTH_QUERY_PARAM, token);
  }

  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

function shell(title: string, activePath: string, search: URLSearchParams, body: string): string {
  const links = [
    ["/app", "Dashboard"],
    ["/app/live", "Live"],
    ["/app/approvals", "Approvals"],
    ["/app/activity", "Activity"],
    ["/app/playbooks", "Playbooks"],
    ["/app/watchers", "Watchers"],
    ["/app/canvas", "Canvas"],
    ["/app/settings", "Settings"],
    ["/app/linking", "Linking"],
    ["/app/onboarding/start", "Onboarding"],
  ] as const;

  const nav = links
    .map(([href, label]) => {
      const active = activePath === href || activePath.startsWith(`${href}/`);
      return `<a href="${withAuthToken(href, search)}" class="${active ? "active" : ""}">${label}</a>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} | Tyrum</title>
  <style>${BASE_STYLE}</style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">Tyrum</div>
      <p class="brand-sub">Single-user, self-hosted runtime control plane.</p>
      <nav class="nav" aria-label="Primary">${nav}</nav>
    </aside>
    <main class="main">
      ${messageBanner(search)}
      ${body}
    </main>
  </div>
  <script>
    (() => {
      const token = new URLSearchParams(window.location.search).get("token");
      if (!token) return;
      const appPrefix = ${JSON.stringify(APP_PATH_PREFIX)};
      const isAppPath = (pathname) => pathname === appPrefix || pathname.startsWith(appPrefix + "/");

      const rewrite = (raw) => {
        try {
          const url = new URL(raw, window.location.origin);
          if (url.origin !== window.location.origin) return raw;
          if (!isAppPath(url.pathname)) return raw;
          if (!url.searchParams.has("token")) {
            url.searchParams.set("token", token);
          }
          return url.pathname + (url.search || "") + (url.hash || "");
        } catch {
          return raw;
        }
      };

      document.querySelectorAll("a[href]").forEach((node) => {
        const href = node.getAttribute("href");
        if (!href) return;
        node.setAttribute("href", rewrite(href));
      });

      document.querySelectorAll("form[action]").forEach((node) => {
        const action = node.getAttribute("action");
        if (!action) return;
        node.setAttribute("action", rewrite(action));
      });
    })();
  </script>
</body>
</html>`;
}

function redirectWithMessage(
  path: string,
  message: string,
  tone: "ok" | "error" = "ok",
  search?: URLSearchParams,
): string {
  const params = new URLSearchParams({ msg: message, tone });
  const token = search ? getAuthQueryToken(search) : undefined;
  if (token) {
    params.set(AUTH_QUERY_PARAM, token);
  }
  return `${path}?${params.toString()}`;
}

function redirectWithMessageFromRequest(
  c: Context,
  path: string,
  message: string,
  tone: "ok" | "error" = "ok",
): string {
  const search = new URL(c.req.url).searchParams;
  return redirectWithMessage(path, message, tone, search);
}

function boolFromForm(input: FormDataEntryValue | null): boolean {
  if (!input) return false;
  const value = String(input).toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function humanizeOption(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderSelectOptions(options: readonly string[], selected: string): string {
  return options
    .map((option) => {
      const isSelected = option === selected;
      return `<option value="${esc(option)}" ${isSelected ? "selected" : ""}>${esc(humanizeOption(option))}</option>`;
    })
    .join("");
}

type PronunciationEntry = {
  token: string;
  pronounce: string;
};

type PamViewState = {
  escalationMode: string;
  limitMinorUnits: string;
  currency: string;
  version: string | null;
};

type PvpViewState = {
  tone: string;
  verbosity: string;
  initiative: string;
  consentStyle: string;
  emojiGifs: string;
  language: string;
  voiceId: string;
  pace: string;
  pitch: string;
  warmth: string;
  pronunciationDict: PronunciationEntry[];
  version: string | null;
};

function extractPamViewState(): PamViewState {
  const profiles = readProfiles();
  const pamRecord = profiles.pam;
  const pamProfile = asRecord(pamRecord?.profile);
  const autoApprove = asRecord(pamProfile?.auto_approve);

  return {
    escalationMode: typeof pamProfile?.escalation_mode === "string" ? pamProfile.escalation_mode : "",
    limitMinorUnits:
      typeof autoApprove?.limit_minor_units === "number"
        ? autoApprove.limit_minor_units.toString()
        : "",
    currency: typeof autoApprove?.currency === "string" ? autoApprove.currency : "",
    version: pamRecord?.version ?? null,
  };
}

function extractPronunciationDict(value: unknown): PronunciationEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: PronunciationEntry[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const token = typeof record.token === "string" ? record.token : "";
    const pronounce = typeof record.pronounce === "string" ? record.pronounce : "";
    entries.push({ token, pronounce });
  }

  return entries;
}

function extractPvpViewState(): PvpViewState {
  const profiles = readProfiles();
  const pvpRecord = profiles.pvp;
  const pvpProfile = asRecord(pvpRecord?.profile);
  const voice = asRecord(pvpProfile?.voice);

  const numberToString = (value: unknown): string =>
    typeof value === "number" ? value.toString() : "";

  return {
    tone: typeof pvpProfile?.tone === "string" ? pvpProfile.tone : "",
    verbosity: typeof pvpProfile?.verbosity === "string" ? pvpProfile.verbosity : "",
    initiative: typeof pvpProfile?.initiative === "string" ? pvpProfile.initiative : "",
    consentStyle: typeof pvpProfile?.consent_style === "string" ? pvpProfile.consent_style : "",
    emojiGifs: typeof pvpProfile?.emoji_gifs === "string" ? pvpProfile.emoji_gifs : "",
    language: typeof pvpProfile?.language === "string" ? pvpProfile.language : "",
    voiceId: typeof voice?.voice_id === "string" ? voice.voice_id : "",
    pace: numberToString(voice?.pace),
    pitch: numberToString(voice?.pitch),
    warmth: numberToString(voice?.warmth),
    pronunciationDict: extractPronunciationDict(voice?.pronunciation_dict),
    version: pvpRecord?.version ?? null,
  };
}

function parseOptionalNumber(name: string, value: string): { ok: true; value?: number } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true };
  }

  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    return { ok: false, message: `${name} must be a number.` };
  }

  return { ok: true, value: parsed };
}

function buildPamProfileFromForm(form: FormData):
  | { ok: true; profile: Record<string, unknown> }
  | { ok: false; message: string } {
  const escalationMode = form.get("escalation_mode")?.toString().trim() ?? "";
  const limitInput = form.get("limit_minor_units")?.toString().trim() ?? "";
  const currency = form.get("currency")?.toString().trim() ?? "";

  const limit = parseOptionalNumber("Auto-approve limit", limitInput);
  if (!limit.ok) {
    return limit;
  }

  const profile: Record<string, unknown> = {};
  if (escalationMode) {
    profile.escalation_mode = escalationMode;
  }

  if (typeof limit.value !== "undefined" || currency) {
    const autoApprove: Record<string, unknown> = {};
    if (typeof limit.value !== "undefined") {
      autoApprove.limit_minor_units = limit.value;
    }
    if (currency) {
      autoApprove.currency = currency;
    }
    profile.auto_approve = autoApprove;
  }

  return { ok: true, profile };
}

function buildPvpProfileFromForm(form: FormData):
  | { ok: true; profile: Record<string, unknown> }
  | { ok: false; message: string } {
  const profile: Record<string, unknown> = {};

  const tone = form.get("tone")?.toString().trim() ?? "";
  const verbosity = form.get("verbosity")?.toString().trim() ?? "";
  const initiative = form.get("initiative")?.toString().trim() ?? "";
  const consentStyle = form.get("consent_style")?.toString().trim() ?? "";
  const emojiGifs = form.get("emoji_gifs")?.toString().trim() ?? "";
  const language = form.get("language")?.toString().trim() ?? "";

  if (tone) profile.tone = tone;
  if (verbosity) profile.verbosity = verbosity;
  if (initiative) profile.initiative = initiative;
  if (consentStyle) profile.consent_style = consentStyle;
  if (emojiGifs) profile.emoji_gifs = emojiGifs;
  if (language) profile.language = language;

  const voiceId = form.get("voice_id")?.toString().trim() ?? "";
  const pace = parseOptionalNumber("Voice pace", form.get("pace")?.toString() ?? "");
  const pitch = parseOptionalNumber("Voice pitch", form.get("pitch")?.toString() ?? "");
  const warmth = parseOptionalNumber("Voice warmth", form.get("warmth")?.toString() ?? "");

  if (!pace.ok) return pace;
  if (!pitch.ok) return pitch;
  if (!warmth.ok) return warmth;

  const voice: Record<string, unknown> = {};
  if (voiceId) {
    voice.voice_id = voiceId;
  }
  if (typeof pace.value !== "undefined") {
    voice.pace = pace.value;
  }
  if (typeof pitch.value !== "undefined") {
    voice.pitch = pitch.value;
  }
  if (typeof warmth.value !== "undefined") {
    voice.warmth = warmth.value;
  }

  const tokenEntries = form.getAll("pron_token").map((entry) => String(entry));
  const pronounceEntries = form.getAll("pron_pronounce").map((entry) => String(entry));

  const maxLength = Math.max(tokenEntries.length, pronounceEntries.length);
  const pronunciationDict: PronunciationEntry[] = [];
  const seenTokens = new Set<string>();

  for (let index = 0; index < maxLength; index += 1) {
    const token = (tokenEntries[index] ?? "").trim();
    const pronounce = (pronounceEntries[index] ?? "").trim();

    if (!token && !pronounce) {
      continue;
    }

    if (!token || !pronounce) {
      return {
        ok: false,
        message: "Pronunciation entries must include both the token and the pronunciation.",
      };
    }

    if (token.length > PRONUNCIATION_MAX_LENGTH || pronounce.length > PRONUNCIATION_MAX_LENGTH) {
      return {
        ok: false,
        message: `Pronunciation entries must be ${String(PRONUNCIATION_MAX_LENGTH)} characters or fewer.`,
      };
    }

    const normalized = token.toLowerCase();
    if (seenTokens.has(normalized)) {
      return {
        ok: false,
        message: `Duplicate pronunciation override for '${token}'.`,
      };
    }
    seenTokens.add(normalized);
    pronunciationDict.push({ token, pronounce });
  }

  if (pronunciationDict.length > PRONUNCIATION_MAX_ENTRIES) {
    return {
      ok: false,
      message: `You can only store up to ${String(PRONUNCIATION_MAX_ENTRIES)} pronunciation overrides.`,
    };
  }

  if (pronunciationDict.length > 0) {
    voice.pronunciation_dict = pronunciationDict;
  }

  if (Object.keys(voice).length > 0) {
    profile.voice = voice;
  }

  return { ok: true, profile };
}

function renderPronunciationRows(entries: PronunciationEntry[]): string {
  const base = entries.length > 0 ? entries : [{ token: "", pronounce: "" }];
  const rows = [...base];

  while (rows.length < 4) {
    rows.push({ token: "", pronounce: "" });
  }

  return rows
    .slice(0, PRONUNCIATION_MAX_ENTRIES)
    .map(
      (entry, index) => `
        <li class="dictionary-row">
          <div>
            <label for="pron-token-${String(index)}">Token</label>
            <input id="pron-token-${String(index)}" name="pron_token" value="${esc(entry.token)}" />
          </div>
          <div>
            <label for="pron-pronounce-${String(index)}">Pronounce as</label>
            <input id="pron-pronounce-${String(index)}" name="pron_pronounce" value="${esc(entry.pronounce)}" />
          </div>
          <div class="helper">Row ${String(index + 1)}</div>
        </li>
      `,
    )
    .join("");
}

function renderSettingsPage(search: URLSearchParams): string {
  const pam = extractPamViewState();
  const pvp = extractPvpViewState();

  const body = `
    <div class="page-header">
      <h1>Account Settings</h1>
      <p>Manage autonomy and persona profiles used by the local single-user runtime.</p>
    </div>

    <section class="settings-columns">
      <article class="card">
        <h2>Autonomy preferences</h2>
        <p class="muted">Configure escalation behavior and spend auto-approval defaults.</p>
        <form method="post" action="/app/actions/settings/pam">
          <label for="pam-escalation">Escalation mode</label>
          <select id="pam-escalation" name="escalation_mode">
            <option value="">Select an option</option>
            ${renderSelectOptions(PAM_ESCALATION_OPTIONS, pam.escalationMode)}
          </select>

          <div class="settings-grid">
            <div>
              <label for="pam-limit">Auto-approve limit (minor units)</label>
              <input id="pam-limit" name="limit_minor_units" type="number" value="${esc(pam.limitMinorUnits)}" />
            </div>
            <div>
              <label for="pam-currency">Currency</label>
              <input id="pam-currency" name="currency" value="${esc(pam.currency)}" />
            </div>
          </div>

          <div class="actions"><button type="submit">Save autonomy preferences</button></div>
          <p class="helper">${pam.version ? `Current version: ${esc(pam.version)}` : "No autonomy profile saved yet."}</p>
        </form>
      </article>

      <article class="card">
        <h2>Persona &amp; voice profile</h2>
        <p class="muted">Set tone, verbosity, initiative, and voice rendering preferences.</p>
        <form method="post" action="/app/actions/settings/pvp">
          <div class="settings-grid">
            <div>
              <label for="pvp-tone">Tone</label>
              <select id="pvp-tone" name="tone">
                <option value="">Select an option</option>
                ${renderSelectOptions(PVP_TONE_OPTIONS, pvp.tone)}
              </select>
            </div>
            <div>
              <label for="pvp-verbosity">Verbosity</label>
              <select id="pvp-verbosity" name="verbosity">
                <option value="">Select an option</option>
                ${renderSelectOptions(PVP_VERBOSITY_OPTIONS, pvp.verbosity)}
              </select>
            </div>
            <div>
              <label for="pvp-initiative">Initiative</label>
              <select id="pvp-initiative" name="initiative">
                <option value="">Select an option</option>
                ${renderSelectOptions(PVP_INITIATIVE_OPTIONS, pvp.initiative)}
              </select>
            </div>
            <div>
              <label for="pvp-consent">Consent style</label>
              <select id="pvp-consent" name="consent_style">
                <option value="">Select an option</option>
                ${renderSelectOptions(PVP_CONSENT_OPTIONS, pvp.consentStyle)}
              </select>
            </div>
            <div>
              <label for="pvp-emoji">Emoji &amp; GIFs</label>
              <select id="pvp-emoji" name="emoji_gifs">
                <option value="">Select an option</option>
                ${renderSelectOptions(PVP_EMOJI_OPTIONS, pvp.emojiGifs)}
              </select>
            </div>
            <div>
              <label for="pvp-language">Preferred language</label>
              <input id="pvp-language" name="language" value="${esc(pvp.language)}" />
            </div>
          </div>

          <div class="settings-grid">
            <div>
              <label for="pvp-voice-id">Voice ID</label>
              <input id="pvp-voice-id" name="voice_id" value="${esc(pvp.voiceId)}" />
            </div>
            <div>
              <label for="pvp-pace">Voice pace</label>
              <input id="pvp-pace" name="pace" type="number" step="any" value="${esc(pvp.pace)}" />
            </div>
            <div>
              <label for="pvp-pitch">Voice pitch</label>
              <input id="pvp-pitch" name="pitch" type="number" step="any" value="${esc(pvp.pitch)}" />
            </div>
            <div>
              <label for="pvp-warmth">Voice warmth</label>
              <input id="pvp-warmth" name="warmth" type="number" step="any" value="${esc(pvp.warmth)}" />
            </div>
          </div>

          <section class="card" style="padding: 12px; margin-top: 12px;">
            <h3>Pronunciation dictionary</h3>
            <p class="muted">Teach Tyrum how to pronounce names and phrases (up to ${String(PRONUNCIATION_MAX_ENTRIES)} entries).</p>
            <ul class="dictionary-list">
              ${renderPronunciationRows(pvp.pronunciationDict)}
            </ul>
            <p class="helper">Leave unused rows blank.</p>
          </section>

          <div class="actions">
            <button type="submit">Save persona profile</button>
          </div>
          <p class="helper">${pvp.version ? `Current version: ${esc(pvp.version)}` : "No persona profile saved yet."}</p>
        </form>
        <form method="post" action="/app/actions/settings/voice-preview">
          <div class="actions"><button type="submit" class="ghost">Preview voice</button></div>
        </form>
      </article>

      <article class="card">
        <h2>Account lifecycle</h2>
        <p class="muted">Export account state or schedule account deletion with an audit reference.</p>
        <div class="actions">
          <form class="inline" method="post" action="/app/actions/account/export">
            <button type="submit">Queue export</button>
          </form>
          <form class="inline" method="post" action="/app/actions/account/delete">
            <button type="submit" class="danger">Queue deletion</button>
          </form>
        </div>
      </article>
    </section>

  `;

  return shell("Settings", "/app/settings", search, body);
}

export function createWebUiRoutes(deps: WebUiDeps): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const search = new URL(c.req.url).searchParams;
    return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tyrum</title>
  <style>${BASE_STYLE}</style>
</head>
<body>
  <main class="main" style="max-width: 900px; margin: 42px auto;">
    <div class="card">
      <h1>Tyrum</h1>
      <p class="muted">Self-hosted autonomous worker platform. Gateway now serves the full web app directly.</p>
      <div class="actions">
        <a href="${withAuthToken("/app", search)}"><button type="button">Open App</button></a>
        <a href="${withAuthToken("/app/settings", search)}"><button type="button" class="secondary">Open Settings</button></a>
      </div>
    </div>
  </main>
</body>
</html>`);
  });

  app.get("/consent", (c) => {
    const search = new URL(c.req.url).searchParams;
    const snap = snapshotConsent();
    const selected = Object.values(snap.selections).filter(Boolean).length;

    const body = `
      <div class="page-header">
        <h1>Consent Checklist</h1>
        <p>Review planner guardrails and persist your preferences.</p>
      </div>

      <article class="card">
        <div class="kv">
          <strong>Selected</strong><span>${String(selected)} / 3</span>
          <strong>Status</strong><span>${snap.revision > 0 ? "Recorded" : "Draft"}</span>
          <strong>Latest reference</strong><span>${esc(snap.auditReference)}</span>
        </div>
      </article>

      <form method="post" action="/app/actions/onboarding/consent">
        <article class="card">
          <label><input type="checkbox" name="shareCalendarSignals" value="true" ${snap.selections.shareCalendarSignals ? "checked" : ""}/> Share scheduling signals</label>
          <p class="helper">Allow Tyrum to read summaries of holds, cancellations, and travel windows.</p>

          <label><input type="checkbox" name="allowPlannerAutonomy" value="true" ${snap.selections.allowPlannerAutonomy ? "checked" : ""}/> Approve autopilot guardrails</label>
          <p class="helper">Permit autonomous actions while spend remains within your limits.</p>

          <label><input type="checkbox" name="retainAuditTrail" value="true" ${snap.selections.retainAuditTrail ? "checked" : ""}/> Retain consent audit trail</label>
          <p class="helper">Persist local proof of every guardrail decision for compliance and export.</p>

          <div class="actions"><button type="submit">Record consent selections</button></div>
        </article>
      </form>
    `;
    return c.html(shell("Consent", "/app/onboarding/consent", search, body));
  });

  app.get("/app/auth", (c) => {
    const search = new URL(c.req.url).searchParams;
    const token = search.get(AUTH_QUERY_PARAM)?.trim();
    const requestedNext = search.get("next") ?? APP_PATH_PREFIX;
    let nextPath = APP_PATH_PREFIX;
    try {
      const parsedNext = new URL(requestedNext, "http://tyrum.local");
      if (matchesPathPrefixSegment(parsedNext.pathname, APP_PATH_PREFIX)) {
        nextPath = `${parsedNext.pathname}${parsedNext.search}${parsedNext.hash}`;
      }
    } catch {
      // Ignore invalid next parameter and fall back to the app root.
    }
    const nextUrl = withAuthToken(nextPath, search);
    if (!token) {
      return c.redirect(nextUrl);
    }
    setCookie(c, AUTH_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
      maxAge: 604800,
    });
    return c.redirect(nextUrl);
  });

  app.get("/app", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const [approvals, episodicEvents, watcherRows] = await Promise.all([
      deps.approvalDal.getByStatus("pending"),
      deps.memoryDal.getEpisodicEvents(20),
      deps.watcherProcessor.listWatchers(),
    ]);
    const pending = approvals.length;
    const events = episodicEvents.length;
    const watchers = watcherRows.length;

    const body = `
      <div class="page-header">
        <h1>Dashboard</h1>
        <p>Operational overview for the local gateway runtime.</p>
      </div>
      <div class="grid">
        <article class="card"><h2>Gateway</h2><p><span class="badge">${deps.isLocalOnly ? "localhost-only" : "exposed"}</span></p></article>
        <article class="card"><h2>Pending Approvals</h2><p>${String(pending)}</p></article>
        <article class="card"><h2>Recent Activity</h2><p>${String(events)} events</p></article>
        <article class="card"><h2>Active Watchers</h2><p>${String(watchers)}</p></article>
      </div>
    `;
    return c.html(shell("Dashboard", "/app", search, body));
  });

  app.get("/app/live", (c) => {
    const search = new URL(c.req.url).searchParams;
    const token = search.get(AUTH_QUERY_PARAM)?.trim() || "";

    const body = `
      <div class="page-header">
        <h1>Live Console</h1>
        <p>Minimal WS timeline + gateway-handled slash commands.</p>
      </div>
      ${
        token
          ? ""
          : `<p class="notice error">Missing token. Open <code>/app/auth?token=...</code> or append <code>?token=...</code> to this URL.</p>`
      }
      <article class="card">
        <div class="kv">
          <div>Connection</div><div id="connStatus" class="badge">disconnected</div>
          <div>Channel</div><div><code>ui</code></div>
          <div>Thread</div>
          <div>
            <code id="threadId"></code>
            <button id="newThread" class="ghost" type="button">New</button>
          </div>
        </div>
        <p class="helper">Use <code>/help</code> for available commands. Commands do not call the model.</p>
      </article>
      <article class="card">
        <div class="calibration-top">
          <h2 class="inline">Timeline</h2>
          <div class="actions">
            <button id="clearLog" class="ghost" type="button">Clear</button>
          </div>
        </div>
        <pre id="log" style="max-height: 420px; overflow: auto; white-space: pre-wrap;"></pre>
      </article>
      <article class="card">
        <form id="sendForm">
          <label for="inputBox">Input</label>
          <textarea id="inputBox" placeholder="Type a message or /command..."></textarea>
          <div class="actions">
            <button type="submit">Send</button>
            <button id="sendHelp" class="ghost" type="button">/help</button>
          </div>
        </form>
      </article>
      <script>
        (() => {
          const qs = new URLSearchParams(window.location.search);
          const token = qs.get("token");
          const connEl = document.getElementById("connStatus");
          const logEl = document.getElementById("log");
          const inputEl = document.getElementById("inputBox");
          const threadEl = document.getElementById("threadId");
          const newThreadBtn = document.getElementById("newThread");
          const clearBtn = document.getElementById("clearLog");
          const helpBtn = document.getElementById("sendHelp");
          const form = document.getElementById("sendForm");

          const channel = "ui";
          const storageKey = "tyrum_ui_thread_id";

          const makeThreadId = () => {
            try { return "ui-" + crypto.randomUUID(); } catch { return "ui-" + String(Date.now()); }
          };

          let threadId = localStorage.getItem(storageKey) || makeThreadId();
          localStorage.setItem(storageKey, threadId);
          threadEl.textContent = threadId;

          const log = (line) => {
            if (!logEl) return;
            const ts = new Date().toISOString();
            logEl.textContent += "[" + ts + "] " + line + "\\n";
            logEl.scrollTop = logEl.scrollHeight;
          };

          const base64url = (str) => {
            try {
              const utf8 = unescape(encodeURIComponent(str));
              return btoa(utf8).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
            } catch {
              return "";
            }
          };

          const setConn = (text) => {
            if (!connEl) return;
            connEl.textContent = text;
          };

          if (!token) {
            log("Missing token; cannot open WS.");
            return;
          }

          const scheme = window.location.protocol === "https:" ? "wss" : "ws";
          const wsUrl = scheme + "://" + window.location.host + "/ws";
          const protocols = [
            "tyrum-v1",
            "tyrum-auth." + base64url(token),
          ];

          const ws = new WebSocket(wsUrl, protocols);

          const send = (msg) => {
            try {
              ws.send(JSON.stringify(msg));
            } catch (err) {
              log("send failed: " + (err && err.message ? err.message : String(err)));
            }
          };

          const request = (type, payload) => {
            const requestId = "ui-" + (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
            send({ request_id: requestId, type, payload });
            return requestId;
          };

          ws.addEventListener("open", () => {
            setConn("connected");
            log("WS open");
            request("connect", { capabilities: [] });
          });

          ws.addEventListener("close", (evt) => {
            setConn("disconnected");
            log("WS closed (code=" + evt.code + ", reason=" + evt.reason + ")");
          });

          ws.addEventListener("error", () => {
            log("WS error");
          });

          ws.addEventListener("message", (evt) => {
            let msg;
            try {
              msg = JSON.parse(String(evt.data));
            } catch {
              log("<< non-json frame");
              return;
            }

            const type = msg.type || "unknown";
            if (Object.prototype.hasOwnProperty.call(msg, "event_id")) {
              log("<< event " + type);
              return;
            }
            if (Object.prototype.hasOwnProperty.call(msg, "ok")) {
              log("<< response " + type + " ok=" + String(msg.ok));
              if (type === "session.send" && msg.ok && msg.result && msg.result.assistant_message) {
                log("assistant: " + String(msg.result.assistant_message));
              }
              if (type === "command.execute" && msg.ok && msg.result && msg.result.output) {
                log(String(msg.result.output));
              }
              return;
            }

            if (type === "ping" && msg.request_id) {
              send({ request_id: msg.request_id, type: "ping", ok: true });
              return;
            }
            log("<< request " + type);
          });

          if (newThreadBtn) {
            newThreadBtn.addEventListener("click", () => {
              threadId = makeThreadId();
              localStorage.setItem(storageKey, threadId);
              threadEl.textContent = threadId;
              log("new thread: " + threadId);
            });
          }

          if (clearBtn) {
            clearBtn.addEventListener("click", () => {
              logEl.textContent = "";
            });
          }

          if (helpBtn) {
            helpBtn.addEventListener("click", () => {
              request("command.execute", { command: "/help" });
            });
          }

          if (form) {
            form.addEventListener("submit", (e) => {
              e.preventDefault();
              const text = (inputEl.value || "").trim();
              if (!text) return;
              inputEl.value = "";

              if (text.startsWith("/")) {
                request("command.execute", { command: text });
                return;
              }

              request("session.send", { channel, thread_id: threadId, content: text });
            });
          }
        })();
      </script>
    `;

    return c.html(shell("Live", "/app/live", search, body));
  });

  app.get("/app/activity", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const events = await deps.memoryDal.getEpisodicEvents(100);
    const rows = events
      .map(
        (event) => `<tr>
          <td>${esc(event.event_id)}</td>
          <td>${esc(event.event_type)}</td>
          <td>${esc(event.channel)}</td>
          <td>${fmtDate(event.occurred_at)}</td>
          <td><pre><code>${formatJson(event.payload)}</code></pre></td>
        </tr>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Activity</h1>
        <p>Live event stream from gateway memory.</p>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>ID</th><th>Type</th><th>Channel</th><th>Occurred</th><th>Payload</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='5' class='muted'>No events yet.</td></tr>"}</tbody>
        </table>
      </div>
    `;
    return c.html(shell("Activity", "/app/activity", search, body));
  });

  app.get("/app/approvals", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const approvals = await deps.approvalDal.getByStatus("pending");

    const list = approvals
      .map(
        (approval) => `<article class="card">
          <h2>#${String(approval.id)}: ${esc(approval.prompt)}</h2>
          <p class="muted">Plan ${esc(approval.plan_id)} step ${String(approval.step_index)} · ${fmtDate(approval.created_at)}</p>
          <div class="actions">
            <a href="/app/approvals/${String(approval.id)}"><button class="secondary" type="button">Details</button></a>
            <form class="inline" method="post" action="/app/actions/approvals/${String(approval.id)}">
              <input type="hidden" name="decision" value="approved" />
              <button type="submit">Approve</button>
            </form>
            <form class="inline" method="post" action="/app/actions/approvals/${String(approval.id)}">
              <input type="hidden" name="decision" value="denied" />
              <button class="danger" type="submit">Deny</button>
            </form>
          </div>
        </article>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Approvals</h1>
        <p>Review and respond to pending planner requests.</p>
      </div>
      ${list || "<div class='card'><p class='muted'>No pending approvals.</p></div>"}
    `;

    return c.html(shell("Approvals", "/app/approvals", search, body));
  });

  app.post("/app/actions/approvals/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/approvals", "Invalid approval id", "error"));
    }

    const form = await c.req.formData();
    const decision = String(form.get("decision") ?? "");
    const approved = decision === "approved";
    const denied = decision === "denied";

    if (!approved && !denied) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/approvals", "Invalid approval decision", "error"));
    }

    const updated = await deps.approvalDal.respond(id, approved, form.get("reason")?.toString());
    if (!updated) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/approvals", "Approval not found or already responded", "error"));
    }

    return c.redirect(redirectWithMessageFromRequest(c, "/app/approvals", `Approval #${String(id)} ${approved ? "approved" : "denied"}`));
  });

  app.get("/app/approvals/:id", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.html(shell("Approval", "/app/approvals", search, "<h1>Approval</h1><p class='notice error'>Invalid approval id</p>"), 400);
    }

    const approval = await deps.approvalDal.getById(id);
    if (!approval) {
      return c.html(shell("Approval", "/app/approvals", search, "<h1>Approval</h1><p class='notice error'>Approval not found</p>"), 404);
    }

    const actions = approval.status === "pending"
      ? `<div class="actions">
          <form class="inline" method="post" action="/app/actions/approvals/${String(approval.id)}">
            <input type="hidden" name="decision" value="approved" />
            <button type="submit">Approve</button>
          </form>
          <form class="inline" method="post" action="/app/actions/approvals/${String(approval.id)}">
            <input type="hidden" name="decision" value="denied" />
            <button class="danger" type="submit">Deny</button>
          </form>
        </div>`
      : "";

    const body = `
      <div class="page-header"><h1>Approval #${String(approval.id)}</h1></div>
      <div class="card">
        <div class="kv">
          <strong>Status</strong><span>${esc(approval.status)}</span>
          <strong>Plan</strong><span>${esc(approval.plan_id)}</span>
          <strong>Step</strong><span>${String(approval.step_index)}</span>
          <strong>Created</strong><span>${fmtDate(approval.created_at)}</span>
          <strong>Responded</strong><span>${fmtDate(approval.responded_at)}</span>
        </div>
        <h2>Prompt</h2>
        <p>${esc(approval.prompt)}</p>
        <h2>Context</h2>
        <pre><code>${formatJson(approval.context)}</code></pre>
        ${actions}
      </div>
      <p><a href="/app/approvals">Back to approvals</a></p>
    `;

    return c.html(shell(`Approval ${approval.id}`, "/app/approvals", search, body));
  });

  app.get("/app/playbooks", (c) => {
    const search = new URL(c.req.url).searchParams;
    const cards = deps.playbooks
      .map(
        (playbook) => `<article class="card">
          <h2>${esc(playbook.manifest.name)}</h2>
          <p class="muted">${esc(playbook.manifest.id)} · ${esc(playbook.manifest.version)}</p>
          <p>${esc(playbook.manifest.description ?? "No description")}</p>
          <p class="muted">${String(playbook.manifest.steps.length)} steps</p>
          <form method="post" action="/app/actions/playbooks/${encodeURIComponent(playbook.manifest.id)}/run">
            <button type="submit">Run</button>
          </form>
        </article>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Playbooks</h1>
        <p>Trigger repeatable automation flows on demand.</p>
      </div>
      ${cards || "<div class='card'><p class='muted'>No playbooks loaded.</p></div>"}
    `;

    return c.html(shell("Playbooks", "/app/playbooks", search, body));
  });

  app.post("/app/actions/playbooks/:id/run", (c) => {
    const id = c.req.param("id");
    const playbook = deps.playbooks.find((entry) => entry.manifest.id === id);
    if (!playbook) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/playbooks", `Playbook '${id}' not found`, "error"));
    }

    const run = deps.playbookRunner.run(playbook);
    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/playbooks",
        `Playbook ${playbook.manifest.name} executed (${run.steps.length} steps).`,
      ),
    );
  });

  app.get("/app/watchers", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const watchers = await deps.watcherProcessor.listWatchers();

    const list = watchers
      .map(
        (watcher) => `<article class="card">
          <h2>#${String(watcher.id)}</h2>
          <p class="muted">${esc(watcher.trigger_type)} · plan ${esc(watcher.plan_id)} · ${fmtDate(watcher.created_at)}</p>
          <pre><code>${formatJson(watcher.trigger_config)}</code></pre>
          <div class="actions">
            <form class="inline" method="post" action="/app/actions/watchers/${String(watcher.id)}/deactivate">
              <button class="secondary" type="submit">Deactivate</button>
            </form>
            <form class="inline" method="post" action="/app/actions/watchers/${String(watcher.id)}/delete">
              <button class="danger" type="submit">Delete</button>
            </form>
          </div>
        </article>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Watchers</h1>
        <p>Manage periodic and completion-triggered watcher rules.</p>
      </div>
      <section class="card">
        <h2>Create watcher</h2>
        <form method="post" action="/app/actions/watchers/create">
          <label for="watcher-plan-id">Plan ID</label>
          <input id="watcher-plan-id" name="plan_id" required />

          <label for="watcher-trigger">Trigger Type</label>
          <select id="watcher-trigger" name="trigger_type">
            <option value="periodic">periodic</option>
            <option value="plan_complete">plan_complete</option>
          </select>

          <label for="watcher-interval">Interval (ms, periodic only)</label>
          <input id="watcher-interval" name="interval_ms" type="number" min="1000" value="60000" />

          <div class="actions"><button type="submit">Create</button></div>
        </form>
      </section>

      ${list || "<div class='card'><p class='muted'>No active watchers.</p></div>"}
    `;

    return c.html(shell("Watchers", "/app/watchers", search, body));
  });

  app.post("/app/actions/watchers/create", async (c) => {
    const form = await c.req.formData();
    const planId = form.get("plan_id")?.toString().trim();
    const triggerType = form.get("trigger_type")?.toString().trim();

    if (!planId || !triggerType) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/watchers", "Plan ID and trigger type are required", "error"));
    }

    const intervalMs = parseInt(form.get("interval_ms")?.toString() ?? "60000", 10);
    const triggerConfig = triggerType === "periodic" ? { intervalMs: Number.isFinite(intervalMs) ? intervalMs : 60000 } : {};

    const id = await deps.watcherProcessor.createWatcher(planId, triggerType, triggerConfig);
    return c.redirect(redirectWithMessageFromRequest(c, "/app/watchers", `Watcher #${String(id)} created.`));
  });

  app.post("/app/actions/watchers/:id/deactivate", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/watchers", "Invalid watcher id", "error"));
    }

    await deps.watcherProcessor.deactivateWatcher(id);
    return c.redirect(redirectWithMessageFromRequest(c, "/app/watchers", `Watcher #${String(id)} deactivated.`));
  });

  app.post("/app/actions/watchers/:id/delete", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/watchers", "Invalid watcher id", "error"));
    }

    await deps.watcherProcessor.deactivateWatcher(id);
    return c.redirect(redirectWithMessageFromRequest(c, "/app/watchers", `Watcher #${String(id)} deleted.`));
  });

  app.get("/app/canvas", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const artifacts = await deps.canvasDal.listRecent(100);

    const rows = artifacts
      .map(
        (artifact) => `<tr>
          <td><a href="/app/canvas/${encodeURIComponent(artifact.id)}">${esc(artifact.title)}</a></td>
          <td>${esc(artifact.id)}</td>
          <td>${esc(artifact.content_type)}</td>
          <td>${fmtDate(artifact.created_at)}</td>
        </tr>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Canvas</h1>
        <p>Recent canvas artifacts generated by automation runs.</p>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Title</th><th>ID</th><th>Type</th><th>Created</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='4' class='muted'>No canvas artifacts available.</td></tr>"}</tbody>
        </table>
      </div>
    `;

    return c.html(shell("Canvas", "/app/canvas", search, body));
  });

  app.get("/app/canvas/:id", async (c) => {
    const search = new URL(c.req.url).searchParams;
    const id = c.req.param("id");
    const artifact = await deps.canvasDal.getById(id);

    if (!artifact) {
      return c.html(
        shell("Canvas", "/app/canvas", search, "<h1>Canvas</h1><p class='notice error'>Canvas artifact not found.</p>"),
        404,
      );
    }

    const body = `
      <div class="page-header"><h1>Canvas Artifact</h1></div>
      <div class="card">
        <div class="kv">
          <strong>ID</strong><span>${esc(artifact.id)}</span>
          <strong>Title</strong><span>${esc(artifact.title)}</span>
          <strong>Content Type</strong><span>${esc(artifact.content_type)}</span>
          <strong>Created</strong><span>${fmtDate(artifact.created_at)}</span>
        </div>
      </div>
      <div class="card">
        <iframe title="Canvas" src="/canvas/${encodeURIComponent(artifact.id)}" style="width:100%; min-height: 480px; border:1px solid #dbe3f1; border-radius:8px"></iframe>
      </div>
      <p><a href="/app/canvas">Back to canvas</a></p>
    `;

    return c.html(shell(`Canvas ${artifact.id}`, "/app/canvas", search, body));
  });

  app.get("/app/settings", (c) => {
    const search = new URL(c.req.url).searchParams;
    return c.html(renderSettingsPage(search));
  });

  app.post("/app/actions/settings/pam", async (c) => {
    const form = await c.req.formData();
    const result = buildPamProfileFromForm(form);
    if (!result.ok) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/settings", result.message, "error"));
    }

    savePamProfile(result.profile);
    return c.redirect(redirectWithMessageFromRequest(c, "/app/settings", "Autonomy preferences saved."));
  });

  app.post("/app/actions/settings/pvp", async (c) => {
    const form = await c.req.formData();
    const result = buildPvpProfileFromForm(form);
    if (!result.ok) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/settings", result.message, "error"));
    }

    savePvpProfile(result.profile);
    return c.redirect(redirectWithMessageFromRequest(c, "/app/settings", "Persona preferences saved."));
  });

  app.post("/app/actions/settings/voice-preview", (c) => {
    const profiles = readProfiles();
    const pvpProfile = asRecord(profiles.pvp?.profile);
    if (!profiles.pvp?.version) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/settings",
          "Save your persona profile before requesting a preview.",
          "error",
        ),
      );
    }

    const voice = asRecord(pvpProfile?.voice);
    const voiceId = typeof voice?.voice_id === "string" ? voice.voice_id.trim() : "";
    if (!voiceId) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/settings",
          "Set a voice ID before requesting a preview.",
          "error",
        ),
      );
    }

    const preview = previewVoice();
    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/settings",
        `Voice preview generated for '${voiceId}' (${preview.format}, ${preview.audio_base64.length} bytes base64).`,
      ),
    );
  });

  app.post("/app/actions/account/:action", (c) => {
    const action = c.req.param("action") === "delete" ? "delete" : c.req.param("action") === "export" ? "export" : null;
    if (!action) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/settings", "Unsupported account action.", "error"));
    }

    const response = buildAuditTaskResponse(action);
    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/settings",
        `${action === "delete" ? "Delete" : "Export"} request enqueued (${response.task.auditReference}).`,
      ),
    );
  });

  app.get("/app/linking", (c) => {
    const search = new URL(c.req.url).searchParams;
    const integrations = listIntegrations();

    const cards = integrations.integrations
      .map(
        (integration) => `<article class="card">
          <h2>${esc(integration.name)}</h2>
          <p class="muted">${esc(integration.slug)}</p>
          <p>${esc(integration.description)}</p>
          <p><strong>Status:</strong> ${integration.enabled ? "Enabled" : "Disabled"}</p>
          <form method="post" action="/app/actions/linking/${encodeURIComponent(integration.slug)}">
            <input type="hidden" name="enabled" value="${integration.enabled ? "false" : "true"}" />
            <button type="submit" class="${integration.enabled ? "danger" : ""}">${integration.enabled ? "Disable" : "Enable"}</button>
          </form>
        </article>`,
      )
      .join("");

    const body = `
      <div class="page-header">
        <h1>Account Linking</h1>
        <p>Toggle placeholder connectors while integration controls remain local-only.</p>
      </div>
      <p class="muted">Account ID: ${esc(integrations.account_id)}</p>
      ${cards}
    `;

    return c.html(shell("Linking", "/app/linking", search, body));
  });

  app.post("/app/actions/linking/:slug", async (c) => {
    const slug = c.req.param("slug");
    const form = await c.req.formData();
    const enabled = boolFromForm(form.get("enabled"));

    const integration = setIntegrationPreference(slug, enabled);
    if (!integration) {
      return c.redirect(redirectWithMessageFromRequest(c, "/app/linking", `Integration '${slug}' not found`, "error"));
    }

    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/linking",
        `${integration.name} ${integration.enabled ? "enabled" : "disabled"}.`,
      ),
    );
  });

  app.get("/app/onboarding/start", (c) => {
    const search = new URL(c.req.url).searchParams;
    const body = `
      <div class="page-header">
        <h1>Onboarding Start</h1>
        <p>Select the operating mode before continuing setup.</p>
      </div>

      <ol class="onboarding-stepper">
        <li class="active">1. Mode</li>
        <li>2. Setup</li>
        <li>3. Consent</li>
      </ol>

      <section class="card">
        <h2>Operating Mode</h2>
        <p class="muted">Local-personal runs a loopback-local gateway. Remote-team connects this desktop app to an external gateway with explicit hardening controls.</p>
        <div class="actions">
          <form method="post" action="/app/actions/onboarding/mode" class="inline" data-mode="embedded">
            <input type="hidden" name="mode" value="embedded" />
            <button type="submit">Use Local-Personal Mode</button>
          </form>
          <form method="post" action="/app/actions/onboarding/mode" class="inline" data-mode="remote">
            <input type="hidden" name="mode" value="remote" />
            <button type="submit" class="secondary">Use Remote-Team Mode</button>
          </form>
        </div>
      </section>

      <section class="card">
        <h2>What happens next</h2>
        <p class="muted">Local-personal continues directly to persona + consent. Remote-team requires hardening checks before consent.</p>
      </section>

      <script>
        (function () {
          const forms = document.querySelectorAll("form[data-mode]");
          for (const form of forms) {
            form.addEventListener("submit", function (event) {
              const mode = form.getAttribute("data-mode");
              if (!mode) return;
              try {
                const hasDesktopHost = Boolean(window.parent && window.parent !== window);
                if (hasDesktopHost) {
                  if (mode === "remote") {
                    event.preventDefault();
                  }
                  window.parent.postMessage({ type: "tyrum:onboarding-mode-selected", mode: mode }, "*");
                }
              } catch {
                // ignore and continue with normal form submission
              }
            });
          }
        })();
      </script>
    `;
    return c.html(shell("Onboarding Start", "/app/onboarding/start", search, body));
  });

  app.post("/app/actions/onboarding/mode", async (c) => {
    const form = await c.req.formData();
    const mode = form.get("mode")?.toString().trim();
    if (mode !== "embedded" && mode !== "remote") {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/onboarding/start",
          "Select Embedded or Remote mode to continue.",
          "error",
        ),
      );
    }

    if (mode === "embedded") {
      persistOperatingMode("local-personal");
      const search = new URL(c.req.url).searchParams;
      return c.redirect(withAuthToken("/app/onboarding/persona", search));
    }

    persistOperatingMode("remote-team");
    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/onboarding/remote-team",
        "Remote-team mode selected. Confirm hardening controls before continuing.",
      ),
    );
  });

  app.get("/app/onboarding/remote-team", (c) => {
    const search = new URL(c.req.url).searchParams;
    const snapshot = snapshotConsent();
    const previous = snapshot.mode === "remote-team" ? snapshot.remoteHardening : undefined;
    const deploymentProfile = previous?.deploymentProfile ?? "split-role";
    const stateStore = previous?.stateStore ?? "postgres";

    const body = `
      <div class="page-header">
        <h1>Remote Team Hardening</h1>
        <p>Record explicit security controls before remote operators connect to this tenant.</p>
      </div>

      <ol class="onboarding-stepper">
        <li>1. Mode</li>
        <li class="active">2. Setup</li>
        <li>3. Consent</li>
      </ol>

      <form method="post" action="/app/actions/onboarding/remote-team">
        <section class="card">
          <h2>Required controls</h2>
          <label><input type="checkbox" name="ownerBootstrapConfirmed" value="true" ${previous?.ownerBootstrapConfirmed ? "checked" : ""} /> First tenant owner bootstrap confirmed</label>
          <p class="helper">Break-glass bootstrap credentials are restricted, rotated, and auditable.</p>

          <label><input type="checkbox" name="nonLocalDeviceApproval" value="true" ${previous?.nonLocalDeviceApproval ? "checked" : ""} /> Non-local operator device approvals require a trusted local channel</label>
          <p class="helper">Remote enrollments are explicitly approved; loopback-only auto-approval is not used.</p>

          <label><input type="checkbox" name="deviceBoundTokens" value="true" ${previous?.deviceBoundTokens ? "checked" : ""} /> Device-bound tokens are required for remote sessions</label>
          <p class="helper">Operator access tokens are bound to device identity and rotation policy.</p>

          <label><input type="checkbox" name="trustedProxyAllowlist" value="true" ${previous?.trustedProxyAllowlist ? "checked" : ""} /> Trusted proxies allowlist configured</label>
          <p class="helper">Forwarding headers are accepted only from explicit proxy addresses.</p>

          <label><input type="checkbox" name="tlsReady" value="true" ${previous?.tlsReady ? "checked" : ""} /> TLS termination is configured for remote access</label>
          <p class="helper">Remote clients connect over TLS before the gateway is exposed beyond loopback.</p>

          <label><input type="checkbox" name="adminModeStepUp" value="true" ${previous?.adminModeStepUp ? "checked" : ""} /> Admin Mode step-up is required for tenant administration</label>
          <p class="helper">Privileged security operations are time-bounded and auditable.</p>
        </section>

        <section class="card">
          <h2>Deployment profile</h2>
          <label for="remote-deployment-profile">Runtime profile</label>
          <select id="remote-deployment-profile" name="deploymentProfile">
            <option value="single-host" ${deploymentProfile === "single-host" ? "selected" : ""}>Single host</option>
            <option value="split-role" ${deploymentProfile === "split-role" ? "selected" : ""}>Split role (gateway-edge / worker / scheduler)</option>
          </select>

          <label for="remote-state-store">Durable StateStore</label>
          <select id="remote-state-store" name="stateStore">
            <option value="sqlite" ${stateStore === "sqlite" ? "selected" : ""}>SQLite (single host)</option>
            <option value="postgres" ${stateStore === "postgres" ? "selected" : ""}>Postgres (recommended for remote-team)</option>
          </select>

          <label><input type="checkbox" name="tlsPinning" value="true" ${previous?.tlsPinning ? "checked" : ""} /> TLS certificate fingerprint is configured for client pinning</label>
          <p class="helper">Certificate pinning is optional but recommended for remote-team traffic.</p>

          <div class="actions"><button type="submit">Record hardening and continue to consent</button></div>
        </section>
      </form>
    `;

    return c.html(shell("Remote Team Hardening", "/app/onboarding/remote-team", search, body));
  });

  app.post("/app/actions/onboarding/remote-team", async (c) => {
    const form = await c.req.formData();

    const ownerBootstrapConfirmed = boolFromForm(form.get("ownerBootstrapConfirmed"));
    const nonLocalDeviceApproval = boolFromForm(form.get("nonLocalDeviceApproval"));
    const deviceBoundTokens = boolFromForm(form.get("deviceBoundTokens"));
    const trustedProxyAllowlist = boolFromForm(form.get("trustedProxyAllowlist"));
    const tlsReady = boolFromForm(form.get("tlsReady"));
    const adminModeStepUp = boolFromForm(form.get("adminModeStepUp"));
    const tlsPinning = boolFromForm(form.get("tlsPinning"));

    const deploymentProfileValue = form.get("deploymentProfile")?.toString().trim();
    const stateStoreValue = form.get("stateStore")?.toString().trim();

    const deploymentProfile =
      deploymentProfileValue === "single-host" || deploymentProfileValue === "split-role"
        ? deploymentProfileValue
        : undefined;
    const stateStore = stateStoreValue === "sqlite" || stateStoreValue === "postgres" ? stateStoreValue : undefined;

    if (
      !ownerBootstrapConfirmed ||
      !nonLocalDeviceApproval ||
      !deviceBoundTokens ||
      !trustedProxyAllowlist ||
      !tlsReady ||
      !adminModeStepUp
    ) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/onboarding/remote-team",
          "Confirm every required hardening control before continuing.",
          "error",
        ),
      );
    }

    if (!deploymentProfile || !stateStore) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/onboarding/remote-team",
          "Choose deployment profile and StateStore before continuing.",
          "error",
        ),
      );
    }

    persistOperatingMode("remote-team", {
      ownerBootstrapConfirmed,
      nonLocalDeviceApproval,
      deviceBoundTokens,
      trustedProxyAllowlist,
      tlsReady,
      adminModeStepUp,
      tlsPinning,
      deploymentProfile,
      stateStore,
    });

    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/onboarding/consent",
        "Remote-team hardening recorded. Continue with consent calibration.",
      ),
    );
  });

  app.get("/app/onboarding/persona", (c) => {
    const search = new URL(c.req.url).searchParams;
    const body = `
      <div class="page-header">
        <h1>Onboarding Persona</h1>
        <p>Capture persona defaults and consent in one guided submission.</p>
      </div>

      <ol class="onboarding-stepper">
        <li>1. Mode</li>
        <li class="active">2. Setup</li>
        <li>3. Consent</li>
      </ol>

      <form method="post" action="/app/actions/onboarding/consent">
        <section class="card">
          <h2>Persona</h2>
          <p class="muted">Set the default voice and behavior profile used in autonomous runs.</p>

          <div class="settings-grid">
            <div>
              <label for="persona-tone">Tone</label>
              <select id="persona-tone" name="tone">
                <option value="upbeat">Upbeat</option>
                <option value="neutral">Neutral</option>
                <option value="formal">Formal</option>
              </select>
            </div>
            <div>
              <label for="persona-verbosity">Verbosity</label>
              <select id="persona-verbosity" name="verbosity">
                <option value="terse">Crisp</option>
                <option value="balanced" selected>Balanced</option>
                <option value="thorough">Thorough</option>
              </select>
            </div>
            <div>
              <label for="persona-initiative">Initiative</label>
              <select id="persona-initiative" name="initiative">
                <option value="ask_first">Ask every time</option>
                <option value="ask_once_per_vendor">Ask once per vendor</option>
                <option value="act_within_limits" selected>Act within limits</option>
              </select>
            </div>
            <div>
              <label for="persona-quiet">Quiet hours</label>
              <input id="persona-quiet" name="quietHours" value="21-07" />
            </div>
            <div>
              <label for="persona-spending">Spending</label>
              <input id="persona-spending" name="spending" value="50" />
            </div>
            <div>
              <label for="persona-voice">Voice sample</label>
              <select id="persona-voice" name="voice">
                <option value="bright">Bright</option>
                <option value="warm" selected>Warm</option>
                <option value="precise">Precise</option>
              </select>
            </div>
          </div>
        </section>

        <section class="card">
          <h2>Consent</h2>
          <p class="muted">Choose which guardrails Tyrum can enforce automatically.</p>
          <label><input type="checkbox" name="shareCalendarSignals" value="true" checked /> Share scheduling signals</label>
          <label><input type="checkbox" name="allowPlannerAutonomy" value="true" checked /> Allow planner autonomy</label>
          <label><input type="checkbox" name="retainAuditTrail" value="true" checked /> Retain audit trail</label>
          <div class="actions"><button type="submit">Record calibration</button></div>
        </section>
      </form>

      <section class="card">
        <h2>What happens next</h2>
        <p class="muted">After saving this baseline, continue to the consent checklist.</p>
      </section>
    `;
    return c.html(shell("Onboarding Persona", "/app/onboarding/persona", search, body));
  });

  app.get("/app/onboarding/consent", (c) => {
    const search = new URL(c.req.url).searchParams;
    const snapshot = snapshotConsent();
    if (snapshot.mode === "remote-team" && !snapshot.remoteHardening) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/onboarding/remote-team",
          "Complete remote-team hardening before continuing to consent.",
          "error",
        ),
      );
    }
    const selected = Object.values(snapshot.selections).filter(Boolean).length;

    const body = `
      <div class="page-header">
        <h1>Onboarding Consent</h1>
        <p>Confirm guardrail toggles before first run.</p>
      </div>
      <article class="card">
        <div class="kv">
          <strong>Operating mode</strong><span>${snapshot.mode === "remote-team" ? "Remote-team" : "Local-personal"}</span>
          <strong>Remote hardening</strong><span>${snapshot.mode === "remote-team" && snapshot.remoteHardening ? "Recorded" : "N/A"}</span>
          <strong>Selected</strong><span>${String(selected)} / 3</span>
          <strong>Status</strong><span>${snapshot.revision > 0 ? "Recorded" : "Draft"}</span>
          <strong>Audit reference</strong><span>${esc(snapshot.auditReference)}</span>
          <strong>Revision</strong><span>${String(snapshot.revision)}</span>
        </div>
      </article>
      <form method="post" action="/app/actions/onboarding/consent">
        <article class="card">
          <label><input type="checkbox" name="shareCalendarSignals" value="true" ${snapshot.selections.shareCalendarSignals ? "checked" : ""}/> Share scheduling signals</label>
          <p class="helper">Allow Tyrum to read summary-level calendar signals for proactive planning.</p>

          <label><input type="checkbox" name="allowPlannerAutonomy" value="true" ${snapshot.selections.allowPlannerAutonomy ? "checked" : ""}/> Approve autopilot guardrails</label>
          <p class="helper">Permit actions under your defined spend and policy limits.</p>

          <label><input type="checkbox" name="retainAuditTrail" value="true" ${snapshot.selections.retainAuditTrail ? "checked" : ""}/> Retain consent audit trail</label>
          <p class="helper">Maintain local tamper-evident consent evidence for review/export.</p>

          <div class="actions"><button type="submit">Record consent selections</button></div>
        </article>
      </form>
    `;

    return c.html(shell("Onboarding Consent", "/app/onboarding/consent", search, body));
  });

  app.post("/app/actions/onboarding/consent", async (c) => {
    const snapshot = snapshotConsent();
    if (snapshot.mode === "remote-team" && !snapshot.remoteHardening) {
      return c.redirect(
        redirectWithMessageFromRequest(
          c,
          "/app/onboarding/remote-team",
          "Complete remote-team hardening before recording consent.",
          "error",
        ),
      );
    }
    const form = await c.req.formData();
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const completedAt = new Date().toISOString();

    const selections = {
      shareCalendarSignals: boolFromForm(form.get("shareCalendarSignals")),
      allowPlannerAutonomy: boolFromForm(form.get("allowPlannerAutonomy")),
      retainAuditTrail: boolFromForm(form.get("retainAuditTrail")),
    };

    const persona = {
      tone: form.get("tone")?.toString(),
      verbosity: form.get("verbosity")?.toString(),
      initiative: form.get("initiative")?.toString(),
      quietHours: form.get("quietHours")?.toString(),
      spending: form.get("spending")?.toString(),
      voice: form.get("voice")?.toString(),
    };

    const calibration = Object.values(persona).some(Boolean)
      ? {
          persona,
          startedAt,
          completedAt,
          durationSeconds: Math.max(0, Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 1000)),
        }
      : undefined;

    const record = persistConsent(selections, calibration);
    return c.redirect(
      redirectWithMessageFromRequest(
        c,
        "/app/onboarding/consent",
        `Consent recorded (${record.auditReference}, revision ${String(record.revision)}).`,
      ),
    );
  });

  app.get("/app/plans/:planId/timeline", (c) => {
    const search = new URL(c.req.url).searchParams;
    const planId = c.req.param("planId");
    const timeline = getPlanTimeline(planId);

    if (!timeline) {
      return c.html(
        shell("Plan Timeline", "/app/activity", search, `<h1>Plan Timeline</h1><p class='notice error'>No timeline found for ${esc(planId)}.</p>`),
        404,
      );
    }

    const rows = timeline.events
      .map(
        (event) => `<tr>
          <td>${String(event.step_index)}</td>
          <td>${fmtDate(event.occurred_at)}</td>
          <td><pre><code>${formatJson(event.action)}</code></pre></td>
          <td>${esc(event.redactions.join(", ") || "none")}</td>
        </tr>`,
      )
      .join("");

    const body = `
      <div class="page-header"><h1>Plan Timeline</h1></div>
      <div class="card">
        <div class="kv">
          <strong>Plan ID</strong><span>${esc(timeline.plan_id)}</span>
          <strong>Generated</strong><span>${fmtDate(timeline.generated_at)}</span>
          <strong>Events</strong><span>${String(timeline.event_count)}</span>
          <strong>Redactions</strong><span>${timeline.has_redactions ? "yes" : "no"}</span>
        </div>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Step</th><th>Occurred</th><th>Action</th><th>Redactions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    return c.html(shell("Plan Timeline", "/app/activity", search, body));
  });

  return app;
}
