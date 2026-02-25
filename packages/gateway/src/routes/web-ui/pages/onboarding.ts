import { snapshotConsent } from "../../../modules/web/consent-store.js";
import { esc, redirectWithMessage, shell } from "../html.js";

export function renderOnboardingStartPage(search: URLSearchParams): string {
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
  return shell("Onboarding Start", "/app/onboarding/start", search, body);
}

export function renderOnboardingRemoteTeamPage(search: URLSearchParams): string {
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

  return shell("Remote Team Hardening", "/app/onboarding/remote-team", search, body);
}

export function renderOnboardingPersonaPage(search: URLSearchParams): string {
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
  return shell("Onboarding Persona", "/app/onboarding/persona", search, body);
}

export type OnboardingConsentPageResult =
  | { type: "redirect"; location: string }
  | { type: "html"; html: string };

export function renderOnboardingConsentPage(search: URLSearchParams): OnboardingConsentPageResult {
  const snapshot = snapshotConsent();
  if (snapshot.mode === "remote-team" && !snapshot.remoteHardening) {
    return {
      type: "redirect",
      location: redirectWithMessage(
        "/app/onboarding/remote-team",
        "Complete remote-team hardening before continuing to consent.",
        "error",
        search,
      ),
    };
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

  return {
    type: "html",
    html: shell("Onboarding Consent", "/app/onboarding/consent", search, body),
  };
}
