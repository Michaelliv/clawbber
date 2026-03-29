# Troubleshooting

## Bot doesn't respond

1. **Check auth**: `mercury auth status` — is a provider configured?
2. **Check Docker**: `docker info` — is Docker running?
3. **Check adapter**: Is the adapter enabled in `.env`? (`MERCURY_ENABLE_WHATSAPP=true`, etc.)
4. **Check logs**: `mercury service logs -f` (if running as service) or check terminal output
5. **Check trigger**: Does your message match `MERCURY_TRIGGER_PATTERNS`? Try `trigger.match=always` via `mrctl config set trigger.match always`

## Docker errors

### "Cannot connect to Docker daemon"
Docker is not running. Start Docker Desktop or the Docker service:
```bash
# macOS
open -a Docker
# Linux
sudo systemctl start docker
```

### "Image not found" or pull errors
Pull the agent image manually:
```bash
docker pull ghcr.io/michaelliv/mercury-agent:latest
```

### Container timeout
The agent took too long. Check:
- Network connectivity (model API must be reachable from container)
- Model provider status
- Increase timeout if needed

## WhatsApp issues

### QR code won't scan
- Ensure your phone and computer are on the same network
- Try the pairing code method: `mercury auth whatsapp --pairing-code --phone <number>`

### Session expired
Re-authenticate: `mercury auth whatsapp`

## Auth issues

### "No credentials found"
Run `mercury auth login` or set `MERCURY_ANTHROPIC_API_KEY` in `.env`.

### OAuth token expired
Mercury auto-refreshes OAuth tokens. If it fails:
```bash
mercury auth logout anthropic
mercury auth login anthropic
```

## Port conflicts

Default port is 8787. If in use:
```bash
MERCURY_CHATSDK_PORT=9090  # Change in .env
```

## Still stuck?

Check the [docs](../../docs/) or open an issue at https://github.com/Michaelliv/mercury/issues.
