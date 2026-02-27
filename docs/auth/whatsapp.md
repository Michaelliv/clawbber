# WhatsApp Authentication

Clawbber connects to WhatsApp using the [Baileys](https://github.com/WhiskeySockets/Baileys) library, which implements the WhatsApp Web protocol. This means you need to link your WhatsApp account just like you would link WhatsApp Web.

## Initial Setup

### QR Code Mode (Recommended)

The simplest way to authenticate:

```bash
clawbber auth whatsapp
```

This will:
1. Display a QR code in your terminal
2. Wait for you to scan it with WhatsApp
3. Save credentials to `.clawbber/whatsapp-auth/`
4. Exit when authentication is complete

**To scan:**
1. Open WhatsApp on your phone
2. Tap **Settings → Linked Devices → Link a Device**
3. Point your camera at the QR code

### Pairing Code Mode

If you can't scan QR codes (e.g., running on a remote server), use pairing code mode:

```bash
clawbber auth whatsapp --pairing-code --phone 14155551234
```

Replace `14155551234` with your phone number (country code + number, no `+` or spaces).

This will:
1. Request a pairing code from WhatsApp
2. Display an 8-character code
3. Wait for you to enter it on your phone

**To pair:**
1. Open WhatsApp on your phone
2. Tap **Settings → Linked Devices → Link a Device**
3. Tap **"Link with phone number instead"**
4. Enter the code shown in your terminal

## Session Lifecycle

### Session Duration

WhatsApp linked device sessions typically last **~14-20 days** before requiring re-authentication. This is controlled by WhatsApp, not Clawbber.

Signs your session has expired:
- WhatsApp stops receiving messages
- Logs show `connection closed` with `loggedOut` reason
- Status file shows `failed:logged_out`

### Re-authentication

If your session expires:

1. **Stop Clawbber** (if running):
   ```bash
   # Ctrl+C in the terminal running clawbber, or
   pkill -f "bun.*chat-sdk"
   ```

2. **Delete old credentials**:
   ```bash
   rm -rf .clawbber/whatsapp-auth/
   ```

3. **Re-authenticate**:
   ```bash
   clawbber auth whatsapp
   ```

4. **Restart Clawbber**:
   ```bash
   clawbber run
   ```

## Status Files

The auth script writes status files for external monitoring (useful for headless deployments):

| File | Description |
|------|-------------|
| `.clawbber/whatsapp-status.txt` | Current status (`authenticated`, `waiting_qr`, `pairing_code:XXXX`, `failed:reason`) |
| `.clawbber/whatsapp-qr.txt` | Raw QR data for external rendering (deleted after successful auth) |

### Status Values

- `authenticated` — Successfully connected
- `already_authenticated` — Existing valid session found
- `waiting_qr` — Waiting for QR code scan
- `pairing_code:XXXXXXXX` — Waiting for pairing code entry
- `failed:logged_out` — Session was logged out by WhatsApp
- `failed:qr_timeout` — QR code expired before scan
- `failed:515` — Stream error (usually recovers automatically)
- `failed:unknown` — Other connection failure

## Auth Status API Endpoint

When Clawbber is running, you can check auth status via the API:

```bash
curl http://localhost:8787/auth/whatsapp
```

**Responses:**

```json
// Authenticated and connected
{ "status": "authenticated" }

// Waiting for QR scan (includes raw QR data)
{ "status": "waiting", "qr": "2@AbCdEf123..." }

// Disconnected or not yet connected
{ "status": "disconnected" }
```

This endpoint requires no authentication, making it suitable for headless monitoring dashboards.

## Troubleshooting

### "Already authenticated"

If you see this but WhatsApp isn't working:
```bash
rm -rf .clawbber/whatsapp-auth/
clawbber auth whatsapp
```

### QR code times out too quickly

WhatsApp QR codes expire after ~20 seconds. If you're having trouble:
1. Have your phone ready before running the command
2. Use `--pairing-code` mode instead

### "Stream error (515)"

This is usually transient and the auth script will automatically reconnect. If it persists:
```bash
rm -rf .clawbber/whatsapp-auth/
clawbber auth whatsapp
```

### WhatsApp shows "Linked Device" but Clawbber doesn't receive messages

1. Check that `CLAWBBER_ENABLE_WHATSAPP=true` is set in `.env`
2. Check logs for connection errors
3. Try re-authenticating

### Messages from before startup appear

Clawbber ignores messages that were sent before it connected to prevent processing old backlog. This is intentional.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWBBER_ENABLE_WHATSAPP` | `false` | Enable WhatsApp adapter |
| `CLAWBBER_WHATSAPP_AUTH_DIR` | `.clawbber/whatsapp-auth` | Directory for auth credentials |
| `CLAWBBER_DATA_DIR` | `.clawbber` | Base data directory (auth dir is relative to this) |

## Security Notes

- Auth credentials in `.clawbber/whatsapp-auth/` are sensitive — treat them like passwords
- Anyone with access to these files can impersonate your WhatsApp account
- The `/auth/whatsapp` endpoint is unauthenticated — only expose your API port to trusted networks
- Consider using a dedicated WhatsApp number for your bot
