export const OPERATOR_UI_CSS = `
.tyrum-operator-ui {
  /* Legacy palette aliases. Keep existing layout/page CSS working while aligning with the theme system. */
  --bg: var(--tyrum-color-bg, #000);
  --bg-subtle: var(--tyrum-color-bg-subtle, #0a0a0a);
  --card: var(--tyrum-color-bg-card, #111);
  --text: var(--tyrum-color-fg, #ededed);
  --muted: var(--tyrum-color-fg-muted, #888);
  --border: var(--tyrum-color-border, #1a1a1a);
  --primary: var(--tyrum-color-primary, #6366f1);
  --primary-dim: var(--tyrum-color-primary-dim, rgba(99, 102, 241, 0.12));
  --success: var(--tyrum-color-success, #22c55e);
  --danger: var(--tyrum-color-error, #ef4444);

  min-height: 100vh;
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

.tyrum-operator-ui * { box-sizing: border-box; }

.tyrum-operator-ui .admin-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  margin: 0 0 16px;
  border-radius: 10px;
  border: 1px solid rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
}

.tyrum-operator-ui .tyrum-legacy .admin-banner button {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.4);
  color: #fff;
}

.tyrum-operator-ui .tyrum-legacy .admin-gate {
  max-width: 680px;
}

.tyrum-operator-ui .tyrum-legacy .admin-dialog-backdrop {
  position: fixed;
  inset: 0;
  padding: 24px;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  z-index: 50;
}

.tyrum-operator-ui .tyrum-legacy .admin-dialog {
  width: 100%;
  max-width: 640px;
}

.tyrum-operator-ui .tyrum-legacy h1 { margin: 0 0 18px; font-size: 22px; line-height: 1.15; font-weight: 700; }
.tyrum-operator-ui .tyrum-legacy button {
  border: 1px solid transparent;
  background: var(--primary);
  color: #fff;
  border-radius: 6px;
  padding: 8px 20px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.tyrum-operator-ui .tyrum-legacy button:hover { filter: brightness(0.95); }
.tyrum-operator-ui .tyrum-legacy button:disabled { opacity: 0.6; cursor: not-allowed; }
.tyrum-operator-ui .tyrum-legacy textarea {
  width: 100%;
  max-width: 520px;
  display: block;
  margin-top: 6px;
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  resize: vertical;
  line-height: 1.35;
}
.tyrum-operator-ui .tyrum-legacy input[type="text"],
.tyrum-operator-ui .tyrum-legacy input[type="password"] {
  width: 100%;
  max-width: 520px;
  display: block;
  margin-top: 6px;
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  line-height: 1.35;
}
.tyrum-operator-ui .tyrum-legacy label { display: block; color: var(--muted); font-size: 13px; }
.tyrum-operator-ui .tyrum-legacy .stack > * + * { margin-top: 12px; }
.tyrum-operator-ui .tyrum-legacy .alert {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
}
.tyrum-operator-ui .tyrum-legacy .alert.error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.08);
  color: #fecaca;
}
.tyrum-operator-ui .tyrum-legacy .card {
  padding: 14px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
  max-width: 680px;
}
`;
