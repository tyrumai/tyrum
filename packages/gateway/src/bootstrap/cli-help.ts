export const CLI_HELP_TEXT = `Tyrum gateway

Usage:
  tyrum [start|edge|worker|scheduler|desktop-runtime] [--home <path>] [--db <path|postgres-uri>] [--host <host>] [--port <port>] [--role <role>] [--debug] [--log-level <debug|info|warn|error|silent>] [--trusted-proxies <csv>] [--tls-ready|--tls-self-signed|--allow-insecure-http] [--enable-engine-api] [--enable-snapshot-import]
  tyrum check
  tyrum tokens issue-default-tenant-admin [--home <path>] [--db <path|postgres-uri>] [--migrations-dir <path>]
  tyrum tls fingerprint
  tyrum toolrunner
  tyrum plugin install <dir> [--home <path>]
  tyrum update [--channel stable|beta|dev] [--version <version>]
  tyrum --version
  tyrum --help

Notes:
  - Running without subcommands starts all roles (edge + worker + scheduler + desktop-runtime).
  - --debug enables debug logging and stack traces for the current process only.
  - tokens issue-default-tenant-admin prints a newly issued default tenant admin token for local recovery.
  - --version takes precedence over --channel for updates.
`;
