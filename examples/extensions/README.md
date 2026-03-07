# Extension Examples

Real-world Mercury extensions. Copy any of these into `.mercury/extensions/` to use.

| Extension | What it does | Features used |
|-----------|-------------|---------------|
| **charts** | Chart generation via `charts-cli` | cli, skill, permission |
| **pdf** | PDF processing (OCR, form filling, conversion) | cli, skill, permission |
| **gws** | Google Workspace (Drive/Gmail/Calendar/etc.) | cli, skill, permission (admin-only default) |
| **pinchtab** | Browser automation via Playwright | cli, skill, permission, `before_container` hook (env + system prompt) |
| **napkin** | Obsidian vault management + KB distillation | cli, skill, permission, `workspace_init` hook, `before_container` hook, job, config, widget, store |

