# Deployment

Mercury can run as a background daemon with automatic restart on crash.

## Quick Setup

```bash
# Install as user service (recommended)
mercury service install

# Check status
mercury service status

# View logs
mercury service logs -f

# Uninstall when needed
mercury service uninstall
```

## Platform Support

### Linux (systemd)

Mercury installs as a systemd user service by default:

```bash
# Install as user service (no sudo required)
mercury service install

# Or explicitly specify user mode
mercury service install --user
```

The service file is written to `~/.config/systemd/user/mercury.service`.

**Manual systemd commands:**

```bash
# Check status
systemctl --user status mercury

# Restart service
systemctl --user restart mercury

# Stop service
systemctl --user stop mercury

# View logs (follow mode)
journalctl --user -u mercury -f
```

**User service notes:**
- No root/sudo required
- Service runs under your user account
- Starts automatically on user login
- For 24/7 operation without login, enable lingering: `loginctl enable-linger $USER`

### macOS (launchd)

Mercury installs as a launchd user agent:

```bash
mercury service install
```

The plist is written to `~/Library/LaunchAgents/com.mercury.agent.plist`.

Logs are written to `.mercury/logs/` in your project directory:
- `mercury.log` — stdout
- `mercury.error.log` — stderr

**Manual launchd commands:**

```bash
# Check if running
launchctl list com.mercury.agent

# Stop service
launchctl stop com.mercury.agent

# Start service
launchctl start com.mercury.agent

# Unload completely
launchctl unload ~/Library/LaunchAgents/com.mercury.agent.plist

# View logs
tail -f .mercury/logs/mercury.log
```

### Windows

Not currently supported via `mercury service`. Options:

1. **Task Scheduler**: Create a task that runs `mercury run` at startup
2. **NSSM**: Use [NSSM](https://nssm.cc/) to wrap Mercury as a Windows service
3. **PM2**: Use `pm2 start "mercury run" --name mercury`

## Auto-Restart Behavior

Both systemd and launchd are configured to automatically restart Mercury if it crashes:

- **systemd**: `Restart=on-failure` with 10-second delay
- **launchd**: `KeepAlive=true` for immediate restart

## Working Directory

The service is configured to run from the directory where you ran `mercury service install`. This means:

- Your `.env` file is loaded from that directory
- Relative paths in configuration resolve from there
- The `.mercury/` data directory is in that location

If you move your Mercury project, you'll need to uninstall and reinstall the service.

## Logs

### Linux

Logs go to the systemd journal:

```bash
# View recent logs
mercury service logs

# Follow logs in real-time
mercury service logs -f

# Or use journalctl directly
journalctl --user -u mercury -n 100
journalctl --user -u mercury --since "1 hour ago"
```

### macOS

Logs go to files in `.mercury/logs/`:

```bash
# View recent logs
mercury service logs

# Follow logs in real-time
mercury service logs -f

# Or use tail directly
tail -f .mercury/logs/mercury.log
```

## Troubleshooting

### Service fails to start

1. Run `mercury doctor` to check for common issues
2. Check that `mercury run` works manually first
3. Verify `.env` exists and is configured
4. Check logs for errors: `mercury service logs`

### Permission denied (Linux)

If you see permission errors with system-level install, use user mode:

```bash
mercury service install --user
```

### Service not found after reboot (Linux)

Enable user lingering so services start without login:

```bash
loginctl enable-linger $USER
```

### Logs not appearing (macOS)

Check that the log directory exists:

```bash
mkdir -p .mercury/logs
```

Then reinstall the service:

```bash
mercury service uninstall
mercury service install
```

### Multiple instances

Each Mercury project should be installed as a separate service from its own directory. The service name is always `mercury`, so only one instance can be managed per user account.

For multiple instances, consider:
- Running different instances under different user accounts
- Using Docker/Podman with separate containers
- Manual systemd service files with unique names
