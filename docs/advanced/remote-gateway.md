# Remote Gateway Guide

This guide covers running Tyrum on a remote host you control.

## Who this is for

Use this when Tyrum needs to run on a different machine than your local workstation.

## Baseline setup

1. Install Tyrum on the remote host.
2. Start Tyrum with an explicit host and port.
3. Restrict network access using host firewall rules.

Example (TLS termination in front; recommended for larger deployments):

```bash
GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=8788 \
  GATEWAY_TOKEN="$(openssl rand -hex 32)" \
  TYRUM_TLS_READY=1 \
  tyrum start
```

Example (single gateway, secure by default via self-signed HTTPS/WSS):

```bash
GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=8788 \
  GATEWAY_TOKEN="$(openssl rand -hex 32)" \
  TYRUM_TLS_SELF_SIGNED=1 \
  tyrum start
```

Notes:

- Browsers will show a certificate warning for self-signed TLS unless you install a trusted CA.
- The gateway prints the TLS certificate SHA-256 fingerprint at startup, and you can re-print it with `tyrum tls fingerprint`.

## Security expectations

The self-hosted profile is local-first. If you expose a remote endpoint, add network controls and transport protection appropriate for your environment.

Recommended minimum controls:

- Allowlist source IPs.
- Use TLS termination in front of the gateway.
- Optionally configure **TLS certificate fingerprint pinning** for higher-assurance remote access.
- If running behind a reverse proxy, configure `GATEWAY_TRUSTED_PROXIES` so the gateway only trusts `Forwarded` / `X-Forwarded-For` / `X-Real-IP` from known proxy addresses.
- Avoid direct internet exposure without access controls.
- Rotate API keys used by external model providers.

If you are operating in a trusted internal network without TLS (not recommended), you can acknowledge plaintext HTTP by setting `TYRUM_ALLOW_INSECURE_HTTP=1`.

## Operations checklist

- Persist `TYRUM_HOME` on durable storage.
- Keep Node.js and Tyrum updated.
- Monitor process restarts and disk usage.

## TLS certificate pinning (optional)

Pinning lets a **Node-based client** (desktop app / SDK consumers) refuse to connect unless the
remote TLS certificate fingerprint matches what you configured.

Get the server fingerprint (SHA-256):

```bash
openssl s_client -connect example.com:443 -servername example.com < /dev/null 2>/dev/null \
  | openssl x509 -noout -fingerprint -sha256
```

If you run the gateway with `TYRUM_TLS_SELF_SIGNED=1`, you can also use:

```bash
tyrum tls fingerprint
```

Configure pinning:

- **Desktop app:** Connection → Remote → “TLS certificate fingerprint (SHA-256, optional)”
- **Desktop app:** enable “Allow self-signed TLS” when using self-signed certificates
- **SDK (WebSocket):** pass `tlsCertFingerprint256` (and `tlsAllowSelfSigned: true` for self-signed)
- **SDK (HTTP):** pass `tlsCertFingerprint256` (and `tlsAllowSelfSigned: true` for self-signed) to `createTyrumHttpClient`

Notes:

- Pinning is enforced only for `wss://` and `https://` URLs (Node clients only).
- Browser-based clients cannot enforce certificate pinning.
- When pinning is configured, Node clients still perform standard TLS verification (CA trust + hostname validation) and **also** verify the configured fingerprint.
- For IP-only self-signed deployments, set `tlsAllowSelfSigned: true` and verify the fingerprint out-of-band before trusting it.
- For private PKI / self-signed deployments with a CA, add your CA to the OS/Node trust store, or pass `tlsCaCertPem` when constructing `TyrumClient`.

## Troubleshooting

- Gateway unreachable: verify `GATEWAY_HOST`, firewall, and listening port.
- Slow responses: validate upstream model latency and local CPU/memory pressure.
