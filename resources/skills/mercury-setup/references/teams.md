# Teams Setup

## Register a Bot

1. Go to the [Azure Portal](https://portal.azure.com) → **Azure Bot** → **Create**
2. Choose **Multi Tenant** for bot type
3. Note the **App ID** and create a **Client Secret** (App Password)

### Configure Messaging Endpoint

Set the messaging endpoint to:
```
https://your-server.com/teams/messages
```

### Install in Teams

1. Create a Teams app manifest (or use Teams Developer Portal)
2. Upload as a custom app to your organization
3. Add the bot to a team or chat

## Enable

In `.env`:
```bash
MERCURY_ENABLE_TEAMS=true
MERCURY_TEAMS_APP_ID=your-app-id
MERCURY_TEAMS_APP_PASSWORD=your-client-secret
MERCURY_TEAMS_APP_TENANT_ID=your-tenant-id
```

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `MERCURY_ENABLE_TEAMS` | `false` | Enable Teams adapter |
| `MERCURY_TEAMS_APP_ID` | — | Azure Bot App ID |
| `MERCURY_TEAMS_APP_PASSWORD` | — | Azure Bot Client Secret |
| `MERCURY_TEAMS_APP_TENANT_ID` | — | Azure AD Tenant ID |

## Notes

- Teams requires Azure AD registration and a public HTTPS endpoint
- Use a tunnel for local development
- Mercury supports Teams channels and direct messages
