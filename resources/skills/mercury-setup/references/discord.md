# Discord Setup

## Create a Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it
3. Go to **Bot** → click **Reset Token** → copy the token
4. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent**
   - **Server Members Intent** (optional, for member info)
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Attach Files`
6. Copy the generated URL → open it → add the bot to your server

## Enable

In `.env`:
```bash
MERCURY_ENABLE_DISCORD=true
MERCURY_DISCORD_BOT_TOKEN=your-bot-token-here
```

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `MERCURY_ENABLE_DISCORD` | `false` | Enable Discord adapter |
| `MERCURY_DISCORD_BOT_TOKEN` | — | Bot token from Developer Portal |

## Notes

- The bot responds to messages in channels it has access to
- Use trigger patterns (`MERCURY_TRIGGER_PATTERNS`) to control when the bot responds
- Mercury supports Discord threads and file attachments
