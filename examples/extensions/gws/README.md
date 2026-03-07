# gws Extension (Google Workspace CLI)

Admin-gated Mercury extension for Google Workspace APIs via [`@googleworkspace/cli`](https://github.com/googleworkspace/cli).

## What this example shows

- `mercury.cli()` to install `gws`
- `mercury.permission()` with admin-only default access
- `mercury.skill()` so the agent knows how to use `gws`

## Install

Copy into your Mercury project:

```bash
mkdir -p .mercury/extensions/gws
cp -R examples/extensions/gws/* .mercury/extensions/gws/
```

Then restart Mercury (or reinstall service).

## Auth setup (host machine)

1. Install and authenticate `gws` on the host:

```bash
npm i -g @googleworkspace/cli
gws auth login
```

2. Export credentials once:

```bash
gws auth export --unmasked > .mercury/global/gws-credentials.json
```

3. Add to `.env`:

```bash
MERCURY_GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/root/.pi/agent/gws-credentials.json
```

(You can also use `MERCURY_GOOGLE_WORKSPACE_CLI_TOKEN`, but it expires quickly.)

## Verify

```bash
mercury chat --space main --caller "<admin-caller-id>" \
  "run exactly: gws drive files list --params '{\"pageSize\": 3}'"
```

A non-admin caller should be blocked by RBAC.
