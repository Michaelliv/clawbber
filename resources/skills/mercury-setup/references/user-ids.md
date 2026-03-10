# Finding Your Caller ID

Mercury identifies users by their platform-specific caller ID. You need this for `MERCURY_ADMINS` and role assignments.

## How to Find Your ID

### WhatsApp
Your caller ID is your phone number in international format (no `+` prefix):
```
14155551234          # US number
972501234567         # Israel number
```

Send a message to the bot and check the logs for `callerId`.

### Discord
Your caller ID is your Discord user ID (numeric):
1. Enable Developer Mode: User Settings → Advanced → Developer Mode
2. Right-click your name → **Copy User ID**
```
123456789012345678
```

### Slack
Your caller ID is your Slack member ID:
1. Click your profile picture → **Profile**
2. Click **⋮** → **Copy member ID**
```
U01ABCDEF23
```

### Teams
Your caller ID is your Azure AD Object ID:
```
29:1a2b3c4d-5e6f-7890-abcd-ef1234567890
```

Check bot logs after sending a message.

## Setting Admins

In `.env`:
```bash
MERCURY_ADMINS=14155551234,U01ABCDEF23
```

Comma-separated list. Admin gets all permissions across all spaces.
