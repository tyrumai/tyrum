import { useState } from "react";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";
import { Notice } from "../components/Notice.js";

const PAM_ESCALATION_OPTIONS = ["ask_first", "ask_once_per_vendor", "act_within_limits"];
const PVP_TONE_OPTIONS = ["calm", "energetic", "witty", "formal", "playful"];
const PVP_VERBOSITY_OPTIONS = ["terse", "balanced", "thorough"];
const PVP_INITIATIVE_OPTIONS = ["low", "medium", "high"];
const PVP_CONSENT_OPTIONS = ["ask_first", "ask_once_per_vendor", "act_within_limits"];
const PVP_EMOJI_OPTIONS = ["never", "sometimes", "often"];
const PRONUNCIATION_MAX_ENTRIES = 32;

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface PamProfile {
  escalation_mode?: string;
  limit_minor_units?: number;
  currency?: string;
  version?: string;
}

interface PronunciationEntry {
  token: string;
  pronounce: string;
}

interface PvpProfile {
  tone?: string;
  verbosity?: string;
  initiative?: string;
  consent_style?: string;
  emoji_gifs?: string;
  language?: string;
  voice?: {
    voice_id?: string;
    pace?: number;
    pitch?: number;
    warmth?: number;
  };
  pronunciation_dictionary?: PronunciationEntry[];
  version?: string;
}

interface ProfilesResponse {
  pam?: { profile: PamProfile; version?: string };
  pvp?: { profile: PvpProfile; version?: string };
}

function SelectField({
  label,
  id,
  value,
  options,
  onChange,
}: {
  label: string;
  id: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select an option</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {humanize(opt)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Settings() {
  const { data, error, loading, refetch } = useApi<ProfilesResponse>(
    () => apiFetch<ProfilesResponse>("/api/profiles"),
    [],
  );

  const [notice, setNotice] = useState<{ message: string; tone: "ok" | "error" } | null>(null);

  const [pamEscalation, setPamEscalation] = useState("");
  const [pamLimit, setPamLimit] = useState("");
  const [pamCurrency, setPamCurrency] = useState("");

  const [pvpTone, setPvpTone] = useState("");
  const [pvpVerbosity, setPvpVerbosity] = useState("");
  const [pvpInitiative, setPvpInitiative] = useState("");
  const [pvpConsent, setPvpConsent] = useState("");
  const [pvpEmoji, setPvpEmoji] = useState("");
  const [pvpLanguage, setPvpLanguage] = useState("");
  const [pvpVoiceId, setPvpVoiceId] = useState("");
  const [pvpPace, setPvpPace] = useState("");
  const [pvpPitch, setPvpPitch] = useState("");
  const [pvpWarmth, setPvpWarmth] = useState("");
  const [dictRows, setDictRows] = useState<PronunciationEntry[]>([{ token: "", pronounce: "" }]);
  const [pamInitialized, setPamInitialized] = useState(false);
  const [pvpInitialized, setPvpInitialized] = useState(false);

  if (data && !pamInitialized) {
    const pam = data.pam?.profile;
    if (pam) {
      setPamEscalation(pam.escalation_mode ?? "");
      setPamLimit(pam.limit_minor_units != null ? String(pam.limit_minor_units) : "");
      setPamCurrency(pam.currency ?? "");
    }
    setPamInitialized(true);
  }

  if (data && !pvpInitialized) {
    const pvp = data.pvp?.profile;
    if (pvp) {
      setPvpTone(pvp.tone ?? "");
      setPvpVerbosity(pvp.verbosity ?? "");
      setPvpInitiative(pvp.initiative ?? "");
      setPvpConsent(pvp.consent_style ?? "");
      setPvpEmoji(pvp.emoji_gifs ?? "");
      setPvpLanguage(pvp.language ?? "");
      setPvpVoiceId(pvp.voice?.voice_id ?? "");
      setPvpPace(pvp.voice?.pace != null ? String(pvp.voice.pace) : "");
      setPvpPitch(pvp.voice?.pitch != null ? String(pvp.voice.pitch) : "");
      setPvpWarmth(pvp.voice?.warmth != null ? String(pvp.voice.warmth) : "");
      if (pvp.pronunciation_dictionary?.length) {
        setDictRows(pvp.pronunciation_dictionary);
      }
    }
    setPvpInitialized(true);
  }

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;

  async function savePam(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      await apiFetch("/api/profiles/pam", {
        method: "PUT",
        body: JSON.stringify({
          escalation_mode: pamEscalation || undefined,
          limit_minor_units: pamLimit ? Number(pamLimit) : undefined,
          currency: pamCurrency || undefined,
        }),
      });
      setNotice({ message: "Autonomy preferences saved.", tone: "ok" });
      refetch();
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Failed to save.", tone: "error" });
    }
  }

  async function savePvp(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const dict = dictRows.filter((r) => r.token.trim());
    try {
      await apiFetch("/api/profiles/pvp", {
        method: "PUT",
        body: JSON.stringify({
          tone: pvpTone || undefined,
          verbosity: pvpVerbosity || undefined,
          initiative: pvpInitiative || undefined,
          consent_style: pvpConsent || undefined,
          emoji_gifs: pvpEmoji || undefined,
          language: pvpLanguage || undefined,
          voice: {
            voice_id: pvpVoiceId || undefined,
            pace: pvpPace ? Number(pvpPace) : undefined,
            pitch: pvpPitch ? Number(pvpPitch) : undefined,
            warmth: pvpWarmth ? Number(pvpWarmth) : undefined,
          },
          pronunciation_dictionary: dict.length ? dict : undefined,
        }),
      });
      setNotice({ message: "Persona preferences saved.", tone: "ok" });
      refetch();
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Failed to save.", tone: "error" });
    }
  }

  function addDictRow() {
    if (dictRows.length >= PRONUNCIATION_MAX_ENTRIES) return;
    setDictRows([...dictRows, { token: "", pronounce: "" }]);
  }

  function removeDictRow(index: number) {
    setDictRows(dictRows.filter((_, i) => i !== index));
  }

  function updateDictRow(index: number, field: "token" | "pronounce", value: string) {
    const updated = [...dictRows];
    updated[index] = { ...updated[index], [field]: value };
    setDictRows(updated);
  }

  async function queueExport() {
    setNotice(null);
    try {
      await apiFetch("/api/account/export", { method: "POST" });
      setNotice({ message: "Export request enqueued.", tone: "ok" });
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Export failed.", tone: "error" });
    }
  }

  async function queueDeletion() {
    if (!window.confirm("Are you sure you want to delete your account? This cannot be undone.")) return;
    setNotice(null);
    try {
      await apiFetch("/api/account/delete", { method: "POST" });
      setNotice({ message: "Delete request enqueued.", tone: "ok" });
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Deletion failed.", tone: "error" });
    }
  }

  const pamVersion = data?.pam?.version;
  const pvpVersion = data?.pvp?.version;

  return (
    <>
      <PageHeader title="Account Settings" subtitle="Manage autonomy and persona profiles used by the local single-user runtime." />

      {notice && <Notice message={notice.message} tone={notice.tone} />}

      <section className="settings-columns">
        <Card>
          <h2>Autonomy preferences</h2>
          <p className="muted">Configure escalation behavior and spend auto-approval defaults.</p>
          <form onSubmit={savePam}>
            <label htmlFor="pam-escalation">Escalation mode</label>
            <select id="pam-escalation" value={pamEscalation} onChange={(e) => setPamEscalation(e.target.value)}>
              <option value="">Select an option</option>
              {PAM_ESCALATION_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{humanize(opt)}</option>
              ))}
            </select>

            <div className="settings-grid">
              <div>
                <label htmlFor="pam-limit">Auto-approve limit (minor units)</label>
                <input id="pam-limit" type="number" value={pamLimit} onChange={(e) => setPamLimit(e.target.value)} />
              </div>
              <div>
                <label htmlFor="pam-currency">Currency</label>
                <input id="pam-currency" value={pamCurrency} onChange={(e) => setPamCurrency(e.target.value)} />
              </div>
            </div>

            <div className="actions"><button type="submit">Save autonomy preferences</button></div>
            <p className="helper">{pamVersion ? `Current version: ${pamVersion}` : "No autonomy profile saved yet."}</p>
          </form>
        </Card>

        <Card>
          <h2>Persona &amp; voice profile</h2>
          <p className="muted">Set tone, verbosity, initiative, and voice rendering preferences.</p>
          <form onSubmit={savePvp}>
            <div className="settings-grid">
              <SelectField label="Tone" id="pvp-tone" value={pvpTone} options={PVP_TONE_OPTIONS} onChange={setPvpTone} />
              <SelectField label="Verbosity" id="pvp-verbosity" value={pvpVerbosity} options={PVP_VERBOSITY_OPTIONS} onChange={setPvpVerbosity} />
              <SelectField label="Initiative" id="pvp-initiative" value={pvpInitiative} options={PVP_INITIATIVE_OPTIONS} onChange={setPvpInitiative} />
              <SelectField label="Consent style" id="pvp-consent" value={pvpConsent} options={PVP_CONSENT_OPTIONS} onChange={setPvpConsent} />
              <SelectField label="Emoji &amp; GIFs" id="pvp-emoji" value={pvpEmoji} options={PVP_EMOJI_OPTIONS} onChange={setPvpEmoji} />
              <div>
                <label htmlFor="pvp-language">Preferred language</label>
                <input id="pvp-language" value={pvpLanguage} onChange={(e) => setPvpLanguage(e.target.value)} />
              </div>
            </div>

            <div className="settings-grid">
              <div>
                <label htmlFor="pvp-voice-id">Voice ID</label>
                <input id="pvp-voice-id" value={pvpVoiceId} onChange={(e) => setPvpVoiceId(e.target.value)} />
              </div>
              <div>
                <label htmlFor="pvp-pace">Voice pace</label>
                <input id="pvp-pace" type="number" step="any" value={pvpPace} onChange={(e) => setPvpPace(e.target.value)} />
              </div>
              <div>
                <label htmlFor="pvp-pitch">Voice pitch</label>
                <input id="pvp-pitch" type="number" step="any" value={pvpPitch} onChange={(e) => setPvpPitch(e.target.value)} />
              </div>
              <div>
                <label htmlFor="pvp-warmth">Voice warmth</label>
                <input id="pvp-warmth" type="number" step="any" value={pvpWarmth} onChange={(e) => setPvpWarmth(e.target.value)} />
              </div>
            </div>

            <section className="card" style={{ padding: 12, marginTop: 12 }}>
              <h3>Pronunciation dictionary</h3>
              <p className="muted">Teach Tyrum how to pronounce names and phrases (up to {PRONUNCIATION_MAX_ENTRIES} entries).</p>
              <ul className="dictionary-list">
                {dictRows.map((row, i) => (
                  <li key={i}>
                    <input placeholder="Token" value={row.token} onChange={(e) => updateDictRow(i, "token", e.target.value)} />
                    <input placeholder="Pronounce" value={row.pronounce} onChange={(e) => updateDictRow(i, "pronounce", e.target.value)} />
                    <button type="button" className="ghost" onClick={() => removeDictRow(i)}>Remove</button>
                  </li>
                ))}
              </ul>
              <button type="button" className="ghost" onClick={addDictRow}>Add row</button>
              <p className="helper">Leave unused rows blank.</p>
            </section>

            <div className="actions">
              <button type="submit">Save persona profile</button>
            </div>
            <p className="helper">{pvpVersion ? `Current version: ${pvpVersion}` : "No persona profile saved yet."}</p>
          </form>
        </Card>

        <Card>
          <h2>Account lifecycle</h2>
          <p className="muted">Export account state or schedule account deletion with an audit reference.</p>
          <div className="actions">
            <button type="button" onClick={queueExport}>Queue export</button>
            <button type="button" className="danger" onClick={queueDeletion}>Queue deletion</button>
          </div>
        </Card>
      </section>
    </>
  );
}
