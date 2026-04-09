export const CLI_HELP_TEXT = `Tyrum gateway

Usage:
  tyrum [start|edge|worker|scheduler|desktop-runtime] [--home <path>] [--db <path|postgres-uri>] [--host <host>] [--port <port>] [--role <role>] [--desktop-takeover-advertise-origin <http(s)://host>] [--debug] [--log-level <debug|info|warn|error|silent>] [--trusted-proxies <csv>] [--tls-ready|--allow-insecure-http] [--enable-snapshot-import]
  tyrum check
  tyrum tokens issue-default-tenant-admin [--home <path>] [--db <path|postgres-uri>] [--migrations-dir <path>]
  tyrum tailscale serve <enable|status|disable> [--home <path>] [--db <path|postgres-uri>] [--migrations-dir <path>] [--gateway-host <host>] [--gateway-port <port>] [--json]
  tyrum toolrunner
  tyrum plugin install <dir> [--home <path>]
  tyrum update [--channel stable|beta|dev] [--version <version>]
  tyrum --version
  tyrum --help

Notes:
  - Running without subcommands starts all roles (edge + worker + scheduler + desktop-runtime).
  - --desktop-takeover-advertise-origin sets the public host origin used when desktop-runtime hosts advertise proxied takeover upstreams.
  - --debug enables debug logging and stack traces for the current process only.
  - tokens issue-default-tenant-admin prints a newly issued default tenant admin token for local recovery.
  - --version takes precedence over --channel for updates.
`;
