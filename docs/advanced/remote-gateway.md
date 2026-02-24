# Remote Gateway Guide

This guide covers running Tyrum on a remote host you control.

## Who this is for

Use this when Tyrum needs to run on a different machine than your local workstation.

## Baseline setup

1. Install Tyrum on the remote host.
2. Start Tyrum with an explicit host and port.
3. Restrict network access using host firewall rules.

Example:

```bash
GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=8788 \
  GATEWAY_TOKEN="$(openssl rand -hex 32)" \
  TYRUM_TLS_READY=1 \
  tyrum start
```

## Security expectations

The self-hosted profile is local-first. If you expose a remote endpoint, add network controls and transport protection appropriate for your environment.

Recommended minimum controls:

- Allowlist source IPs.
- Use TLS termination in front of the gateway.
- If running behind a reverse proxy, configure `GATEWAY_TRUSTED_PROXIES` so the gateway only trusts `Forwarded` / `X-Forwarded-For` / `X-Real-IP` from known proxy addresses.
- Avoid direct internet exposure without access controls.
- Rotate API keys used by external model providers.

If you are operating in a trusted internal network without TLS (not recommended), you can acknowledge plaintext HTTP by setting `TYRUM_ALLOW_INSECURE_HTTP=1`.

## Operations checklist

- Persist `TYRUM_HOME` on durable storage.
- Keep Node.js and Tyrum updated.
- Monitor process restarts and disk usage.

## Troubleshooting

- Gateway unreachable: verify `GATEWAY_HOST`, firewall, and listening port.
- Slow responses: validate upstream model latency and local CPU/memory pressure.
