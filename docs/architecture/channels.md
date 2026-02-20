# Channels

Channels are message transports that connect Tyrum to external chat surfaces. A channel connector normalizes inbound messages into session events and sends outbound messages when the agent replies.

## Channel types (examples)

- WhatsApp (DM, group)
- Telegram (DM, group)
- Discord (DM, server channel)
- Mattermost (DM, channel)
- IRC (DM, channel)
- Slack (DM, channel)

## Normalized containers

Even when APIs differ, Tyrum should normalize "where a conversation lives" into a small set of containers:

- **DM:** direct message thread
- **Group:** group chat
- **Channel:** named channel (server/workspace)

## Safety expectations

- Connector configuration should be explicit and scoped.
- Message sending should be auditable (evented) and redact secrets by default.
