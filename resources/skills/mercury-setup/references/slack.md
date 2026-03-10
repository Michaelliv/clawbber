# Slack Setup

## Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it and select your workspace

### Bot Token Scopes

Go to **OAuth & Permissions** → **Bot Token Scopes** and add:
- `chat:write` — send messages
- `channels:history` — read channel messages
- `groups:history` — read private channel messages
- `im:history` — read DMs
- `files:read` — access shared files
- `files:write` — upload files

### Event Subscriptions

Go to **Event Subscriptions** → enable → set Request URL to your server:
```
https://your-server.com/slack/events
```

Subscribe to bot events:
- `message.channels`
- `message.groups`
- `message.im`

### Install to Workspace

Go to **Install App** → **Install to Workspace** → authorize.

Copy the **Bot User OAuth Token** (`xoxb-...`) and **Signing Secret** (from Basic Information).

## Enable

In `.env`:
```bash
MERCURY_ENABLE_SLACK=true
MERCURY_SLACK_BOT_TOKEN=xoxb-your-token
MERCURY_SLACK_SIGNING_SECRET=your-signing-secret
```

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `MERCURY_ENABLE_SLACK` | `false` | Enable Slack adapter |
| `MERCURY_SLACK_BOT_TOKEN` | — | Bot User OAuth Token (`xoxb-...`) |
| `MERCURY_SLACK_SIGNING_SECRET` | — | App signing secret |

## Notes

- Slack requires a publicly accessible URL for event subscriptions
- Use a tunnel (e.g., ngrok, Cloudflare Tunnel) for local development
- Mercury handles message threading automatically
