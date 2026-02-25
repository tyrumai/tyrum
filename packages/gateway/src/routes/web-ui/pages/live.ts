import { AUTH_QUERY_PARAM, shell } from "../html.js";

export function renderLivePage(search: URLSearchParams): string {
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
              request("command.execute", { command: "/help", channel, thread_id: threadId });
            });
          }

          if (form) {
            form.addEventListener("submit", (e) => {
              e.preventDefault();
              const text = (inputEl.value || "").trim();
              if (!text) return;
              inputEl.value = "";

              if (text.startsWith("/")) {
                request("command.execute", { command: text, channel, thread_id: threadId });
                return;
              }

              request("session.send", { channel, thread_id: threadId, content: text });
            });
          }
        })();
      </script>
    `;

  return shell("Live", "/app/live", search, body);
}
