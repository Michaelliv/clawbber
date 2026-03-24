# Deployment Guide

Deploy a Mercury agent to a remote server. This guide covers the full flow from project creation to a running agent on WhatsApp.

## Prerequisites

**Local machine:**
- Docker (for building images)
- Bun runtime
- Mercury CLI (`bun link` from the mercury-firecracker repo)
- SSH access to the target server

**Target server:**
- Docker installed
- ARM64 or AMD64 architecture
- SSH access
- Sufficient RAM (4GB+ recommended)
- `--cap-add SYS_ADMIN` support (for bubblewrap sandbox)

## 1. Initialize Project

```bash
mkdir ~/Projects/my-agent
cd ~/Projects/my-agent
mercury init
```

This creates:
- `.env` — configuration template
- `workspace/AGENTS.md` — default agent persona
- `state.db` — database with first API key

**Save the API key** — it's shown once during init.

## 2. Install Extensions

Extensions come from the [mercury-extensions](https://github.com/Michaelliv/mercury-extensions) repo. Install the ones you need:

```bash
mercury ext add git:github.com/Michaelliv/mercury-extensions#packages/knowledge
mercury ext add git:github.com/Michaelliv/mercury-extensions#packages/web-browser
mercury ext add git:github.com/Michaelliv/mercury-extensions#packages/charts
mercury ext add git:github.com/Michaelliv/mercury-extensions#packages/diagrams
mercury ext add git:github.com/Michaelliv/mercury-extensions#packages/github
mercury ext add git:github.com/Michaelliv/mercury-extensions#packages/google-workspace
```

Verify:
```bash
mercury ext list
```

## 3. Configure Environment

Edit `.env`:

```bash
# Identity
MERCURY_BOT_USERNAME=mercury
MERCURY_PORT=3000
MERCURY_TRIGGER_PATTERNS=@Mercury,Mercury

# Model
MERCURY_MODEL_PROVIDER=anthropic
MERCURY_MODEL=claude-sonnet-4-20250514

# Ingress (enable at least one, or none for CLI-only)
MERCURY_ENABLE_WHATSAPP=true

# Extension env vars (as needed)
MERCURY_GH_TOKEN=ghp_...
MERCURY_GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/root/.pi/agent/gws-credentials.json
MERCURY_AGENT_BROWSER_USER_AGENT=Mozilla/5.0 ...
MERCURY_AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage
```

## 4. Authenticate with AI Provider

```bash
mercury auth login anthropic    # Opens browser for OAuth
mercury auth status             # Verify credentials
```

This saves credentials to `workspace/auth.json`. OAuth tokens auto-refresh.

Alternatively, set an API key directly in `.env`:
```bash
MERCURY_ANTHROPIC_API_KEY=sk-ant-...
```

## 5. Define Agent Persona

Edit `workspace/AGENTS.md` with your agent's personality, capabilities, and security rules. See the template created by `mercury init` for the structure.

## 6. Build Docker Image

```bash
mercury build
```

This creates `mercury:latest` with all extension CLIs baked in. The build injects `RUN` commands for each extension's CLI install (e.g., `bun add -g napkin-ai`).

## 7. Transfer to Server

### Push the image

```bash
docker save mercury:latest | ssh user@server "docker load"
```

### Push the data

```bash
# Transfer the project
scp -r . user@server:~/my-agent
scp .env user@server:~/my-agent/.env

# Fix ownership (container may have written files as root previously)
ssh user@server "sudo chown -R \$(whoami) ~/my-agent"
```

## 8. Create API Key on Server

The API key created during `mercury init` is in the local DB. After transferring, verify it works or create a new one:

```bash
ssh user@server "docker run --rm --entrypoint bun \
  -v ~/my-agent:/data \
  mercury:latest run /app/src/cli/mercury.ts api-keys list"
```

If no keys show up (WAL checkpoint issue), create one:

```bash
ssh user@server "docker run --rm --entrypoint bun \
  -v ~/my-agent:/data \
  mercury:latest run /app/src/cli/mercury.ts api-keys create remote"
```

**Save the key.**

## 9. Start the Container

```bash
ssh user@server "cd ~/my-agent && docker run -d \
  --name my-agent \
  --restart unless-stopped \
  --cap-add SYS_ADMIN \
  --security-opt seccomp=unconfined \
  -v \$(pwd)/project:/data \
  --env-file .env \
  -p 3000:3000 \
  mercury:latest"
```

Check logs:
```bash
ssh user@server "docker logs my-agent --tail 20"
```

You should see:
```
Extensions loaded count=6
WhatsApp connected  (if enabled)
Server started port=3000 adapters=whatsapp
```

## 10. Authenticate WhatsApp (if enabled)

### Option A: Copy existing session
If you have an existing WhatsApp session from another deployment:

```bash
scp -r /path/to/existing/whatsapp-auth user@server:~/my-agent/
ssh user@server "sudo chown -R \$(whoami) ~/my-agent/whatsapp-auth"
ssh user@server "docker restart my-agent"
```

### Option B: Fresh authentication
Run the auth flow inside the container. Use pairing code for headless servers:

```bash
ssh user@server "docker run -it --rm \
  -v ~/my-agent:/data \
  --entrypoint bun mercury:latest \
  run /app/src/cli/mercury.ts auth whatsapp --pairing-code --phone <your-number>"
```

Then restart the container.

## 11. Pair via WhatsApp DM

Get the pairing code:

```bash
# Via SSH tunnel
ssh -L 4000:localhost:3000 user@server

curl -s http://localhost:4000/api/conversations/pairing-code \
  -H "Authorization: Bearer <api-key>" \
  -H "x-mercury-caller: system"
```

Send `/pair <CODE>` as a WhatsApp DM to the bot's number. This grants you admin access.

To pair a group: send `/pair <CODE>` in the group (mentioning the bot).

## File Permissions

The Docker container runs as root. Files created by the container will be owned by root on the host. Fix with:

```bash
ssh user@server "sudo chown -R \$(whoami) ~/my-agent"
```

## Firewall

Ensure the port is accessible if you need external API access:

```bash
# Linux firewall
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload

# Also check cloud provider security groups/lists (AWS, OCI, GCP, etc.)
```

For WhatsApp-only deployments, no inbound port is needed — WhatsApp uses outbound WebSocket connections.

## Updating

```bash
# Rebuild locally with updated code/extensions
mercury build

# Push to server
docker save mercury:latest | ssh user@server "docker load"

# Restart
ssh user@server "docker restart my-agent"
```

## Monitoring

```bash
# Health check
curl -s http://localhost:4000/health -H "Authorization: Bearer <key>"

# Logs
ssh user@server "docker logs -f my-agent"

# Chat test
curl -s -X POST http://localhost:4000/chat \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"text": "hello"}'
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `No API key found for anthropic` | Run `mercury auth login anthropic` locally, re-copy `auth.json` |
| `Extensions loaded count=0` | Ensure `extensions/` is in the volume mount |
| API key invalid after restart | WAL checkpoint issue — create key via one-off container (step 8) |
| WhatsApp QR code cut off | Use `--pairing-code` mode instead |
| Permission denied on files | `sudo chown -R $(whoami) ~/my-agent` |
| Port not reachable externally | Check OS firewall + cloud security groups |
