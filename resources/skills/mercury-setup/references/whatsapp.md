# WhatsApp Setup

## Enable

```bash
MERCURY_ENABLE_WHATSAPP=true
```

## Authenticate

Mercury uses the Baileys library to connect to WhatsApp via the multi-device protocol.

### QR Code (recommended)

```bash
mercury auth whatsapp
```

Scan the QR code with WhatsApp on your phone:
1. Open WhatsApp → Settings → Linked Devices → Link a Device
2. Scan the terminal QR code

### Pairing Code (headless/SSH)

```bash
mercury auth whatsapp --pairing-code --phone <your-phone-number>
```

Enter the pairing code in WhatsApp → Linked Devices → Link with phone number.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `MERCURY_ENABLE_WHATSAPP` | `false` | Enable WhatsApp adapter |
| `MERCURY_WHATSAPP_AUTH_DIR` | `<dataDir>/whatsapp-auth` | Auth session storage |

## Notes

- WhatsApp auth credentials are stored in `MERCURY_WHATSAPP_AUTH_DIR` — treat like passwords
- The bot appears as a linked device on your WhatsApp account
- If the session expires, re-run `mercury auth whatsapp`
- Media files (images, documents, voice) are supported
