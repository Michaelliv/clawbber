---
name: gws
description: Use Google Workspace CLI (gws) for Drive, Gmail, Calendar, Docs, and Sheets.
allowed-tools: Bash
---

# Google Workspace CLI (`gws`)

Use `gws` directly in bash.


## Quick checks

```bash
gws --version
gws auth status
```

## Examples

```bash
gws drive files list --params '{"pageSize": 5}'
gws calendar calendar-list list
gws gmail users labels list --params '{"userId":"me"}'
```
