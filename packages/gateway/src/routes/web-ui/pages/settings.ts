import { readProfiles } from "../../../modules/web/local-store.js";
import { asRecord, esc, renderSelectOptions, shell } from "../html.js";

const PAM_ESCALATION_OPTIONS = ["ask_first", "ask_once_per_vendor", "act_within_limits"] as const;

const PVP_TONE_OPTIONS = ["calm", "energetic", "witty", "formal", "playful"] as const;
const PVP_VERBOSITY_OPTIONS = ["terse", "balanced", "thorough"] as const;
const PVP_INITIATIVE_OPTIONS = ["low", "medium", "high"] as const;
const PVP_CONSENT_OPTIONS = ["ask_first", "ask_once_per_vendor", "act_within_limits"] as const;
const PVP_EMOJI_OPTIONS = ["never", "sometimes", "often"] as const;

const PRONUNCIATION_MAX_ENTRIES = 32;
const PRONUNCIATION_MAX_LENGTH = 128;

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
    escalationMode:
      typeof pamProfile?.escalation_mode === "string" ? pamProfile.escalation_mode : "",
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

function parseOptionalNumber(
  name: string,
  value: string,
): { ok: true; value?: number } | { ok: false; message: string } {
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

export function buildPamProfileFromForm(
  form: FormData,
): { ok: true; profile: Record<string, unknown> } | { ok: false; message: string } {
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

export function buildPvpProfileFromForm(
  form: FormData,
): { ok: true; profile: Record<string, unknown> } | { ok: false; message: string } {
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

export function renderSettingsPage(search: URLSearchParams): string {
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
