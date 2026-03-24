# Authentication

Mercury needs credentials for three things:

1. **API keys** — to authenticate clients accessing Mercury's HTTP API
2. **AI model provider** — to call the LLM (Anthropic, OpenAI, etc.)
3. **Chat platforms** — to connect to WhatsApp, Discord, Slack (optional)

## API Keys

All Mercury endpoints require an API key via `Authorization: Bearer <key>`.

```bash
mercury api-keys create <name>    # Create key (shown once)
mercury api-keys list             # List keys (prefix only)
mercury api-keys revoke <id>      # Revoke a key
```

The first key is generated during `mercury init`. An internal key is auto-generated at startup for agent subprocess → API communication.

## Model Provider Auth

### OAuth Login (Recommended)

```bash
mercury auth login              # Interactive provider picker
mercury auth login anthropic    # Specify directly
```

| Provider | ID |
|----------|----|
| Anthropic (Claude Pro/Max) | `anthropic` |
| GitHub Copilot | `github-copilot` |
| Google Gemini CLI | `google-gemini-cli` |
| Antigravity | `antigravity` |
| ChatGPT Plus/Pro | `openai-codex` |

Credentials saved to `workspace/auth.json`, auto-refreshed on expiry.

### API Key

Set in `.env`:

```bash
MERCURY_ANTHROPIC_API_KEY=sk-ant-...
```

### Resolution Order

1. OAuth credentials from `auth.json`
2. `MERCURY_ANTHROPIC_API_KEY` from `.env`

### Managing Credentials

```bash
mercury auth status
mercury auth logout anthropic
```

## Chat Platform Auth

### WhatsApp

```bash
mercury auth whatsapp                              # QR code
mercury auth whatsapp --pairing-code --phone 1234  # Pairing code (headless)
```

### Discord

```bash
MERCURY_ENABLE_DISCORD=true
MERCURY_DISCORD_BOT_TOKEN=your-bot-token
```

### Slack

```bash
MERCURY_ENABLE_SLACK=true
MERCURY_SLACK_BOT_TOKEN=xoxb-...
MERCURY_SLACK_SIGNING_SECRET=...
```

## Security

- API keys are SHA-256 hashed in the database — only prefixes stored for identification
- `auth.json` has `0600` permissions
- `MERCURY_*` env vars are passed to the agent subprocess with RBAC gating
- Extension env vars only injected when caller has the extension's permission
- Never commit `.env` or `auth.json` to version control
