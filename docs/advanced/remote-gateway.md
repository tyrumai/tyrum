# Remote Gateway Guide

This guide covers supported ways to run Tyrum on another machine you control.

## Supported patterns

Tyrum no longer generates its own self-signed HTTPS listener. For remote use, choose one of these:

1. Run the gateway behind trusted TLS termination.
2. Keep the gateway on loopback HTTP and expose it through Tailscale Serve.

Both approaches give browsers a real trusted HTTPS origin, which is required for `/ui`, browser-node pairing, location, camera, and microphone access.

## Pattern 1: reverse proxy or load balancer

Use this when you already have DNS and a trusted certificate in front of the host.

```bash
tyrum --host 0.0.0.0 --port 8788 --tls-ready
```

`--tls-ready` acknowledges that TLS is handled outside the gateway. Persisted changes later live under `/system/deployment-config`.

Recommended controls:

- allowlist source IPs where possible
- terminate TLS at the proxy or load balancer
- set `server.publicBaseUrl` to the externally reachable `https://...` origin
- set `server.trustedProxies` to the proxy IPs/CIDRs so forwarded headers are trusted only from known hops
- avoid direct internet exposure without additional access controls

## Pattern 2: Tailscale Serve

Use this when you want a private, trusted HTTPS URL on a tailnet without managing certs yourself.

Run Tyrum on loopback HTTP:

```bash
tyrum --host 127.0.0.1 --port 8788
```

Then enable Tailscale Serve:

```bash
tyrum tailscale serve enable --gateway-host 127.0.0.1 --gateway-port 8788
```

This configures `tailscale serve` to proxy the local gateway and updates `server.publicBaseUrl` to the device's `https://<name>.<tailnet>.ts.net` URL.

Useful commands:

```bash
tyrum tailscale serve status
tyrum tailscale serve disable
```

Notes:

- Tyrum expects the `tailscale` binary to be installed and the device to be logged into a tailnet.
- Tyrum manages only a Tyrum-owned Serve configuration. If the machine is already using `tailscale serve` for something else, Tyrum will refuse to overwrite it.
- The desktop app shows embedded-gateway Tailscale status and enable/disable controls in the Gateway connection screen.

## Plain HTTP on non-loopback

Plaintext HTTP on a non-loopback bind is still possible, but it is an explicit opt-in for trusted networks only:

```bash
tyrum --host 0.0.0.0 --port 8788 --allow-insecure-http
```

This does not create a secure browser context. Remote browser clients and browser-node capabilities will remain blocked unless they access Tyrum through trusted HTTPS.

## TLS certificate pinning for Node clients

Pinning lets a Node-based client refuse to connect unless the remote TLS certificate fingerprint matches what you configured.

Get the server fingerprint:

```bash
openssl s_client -connect example.com:443 -servername example.com < /dev/null 2>/dev/null \
  | openssl x509 -noout -fingerprint -sha256
```

Configure pinning:

- Desktop app remote mode: set `TLS certificate fingerprint (SHA-256, optional)`
- SDK WebSocket: pass `tlsCertFingerprint256`
- SDK HTTP: pass `tlsCertFingerprint256` to `createTyrumHttpClient`

Notes:

- Pinning is enforced only for `wss://` and `https://` URLs in Node clients.
- Browser clients cannot enforce certificate pinning.
- Pinning does not bypass CA trust or hostname validation.
- For private PKI, add your CA to the OS/Node trust store or pass `tlsCaCertPem` to the SDK client.

## Operations checklist

- Persist the gateway home on durable storage (`~/.tyrum` by default, or the path passed via `--home`).
- Keep Node.js, Tyrum, and your reverse proxy or Tailscale client updated.
- Monitor process restarts, disk usage, and proxy or Serve health.

## Troubleshooting

- Gateway unreachable: verify the bind host, firewall rules, and the listening port.
- Browser-node stays disabled: verify the page origin is trusted HTTPS, not plaintext HTTP or an untrusted certificate.
- Tailscale Serve enable fails: confirm `tailscale status --json` shows a running backend and that the device has a DNS name.
