export const OPERATOR_UI_CSS = `
.tyrum-operator-ui {
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

  min-height: 100vh;
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

.tyrum-operator-ui * { box-sizing: border-box; }

.tyrum-operator-ui .layout { display: flex; min-height: 100vh; }
.tyrum-operator-ui .sidebar {
  border-right: 1px solid var(--border);
  background: var(--bg-subtle);
  width: 200px;
  padding: 16px 0;
  color: var(--muted);
  display: flex;
  flex-direction: column;
}

.tyrum-operator-ui .brand {
  font-size: 18px;
  font-weight: 700;
  padding: 0 16px 16px;
  border-bottom: 1px solid var(--border);
  margin: 0 0 8px;
  color: #fff;
}

.tyrum-operator-ui .nav { display: flex; flex-direction: column; }
.tyrum-operator-ui .nav button {
  display: block;
  width: 100%;
  padding: 10px 16px;
  border-left: 3px solid transparent;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 400;
  background: none;
  border-top: none;
  border-right: none;
  border-bottom: none;
  cursor: pointer;
  user-select: none;
  text-align: left;
}

.tyrum-operator-ui .nav button:hover { background: rgba(255, 255, 255, 0.03); }
.tyrum-operator-ui .nav button.active {
  background: var(--primary-dim);
  border-left-color: var(--primary);
  color: #fff;
  font-weight: 600;
}

.tyrum-operator-ui .main {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.tyrum-operator-ui h1 { margin: 0 0 18px; font-size: 22px; line-height: 1.15; font-weight: 700; }
.tyrum-operator-ui button {
  border: 1px solid transparent;
  background: var(--primary);
  color: #fff;
  border-radius: 6px;
  padding: 8px 20px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.tyrum-operator-ui button:hover { filter: brightness(0.95); }
`;
