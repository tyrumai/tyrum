export const BASE_STYLE = `
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
