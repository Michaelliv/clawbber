# Web Search

Extension-based web search and browser automation via installable CLIs (e.g. pinchtab).

Web search is **extension-based** in Mercury.

Mercury core does not ship a built-in browser/search CLI. Instead, install a web automation extension (for example, `pinchtab`) and let the agent use that tool directly.

---

## Recommended Setup

Use the real example extension at:

- `examples/extensions/pinchtab/`

It demonstrates:

- installing browser tooling in the derived image
- `before_container` hook for runtime env injection
- system-prompt guidance for consistent search behavior

---

## Typical Flow

1. Start browser automation tool (`pinchtab`)
2. Navigate to search engine URL (e.g. Brave Search)
3. Extract text/snapshot content
4. Summarize and cite key findings

Example command pattern used by agents:

```bash
pinchtab &
pinchtab nav "https://search.brave.com/search?q=your+query"
pinchtab text
```

---

## Why Extension-Based

- keeps Mercury core lean
- lets each deployment pick its own browser/search stack
- allows per-space RBAC for web tooling (`pinchtab` permission)
- avoids locking users into one provider/tool

---

## Security & RBAC

Extension CLIs are called directly in bash, with RBAC enforced by Mercury's in-container permission guard.

If a caller lacks permission for a web extension CLI, execution is blocked.

---

## Related Docs

- [extensions.md](./extensions.md)
- [pipeline.md](./pipeline.md)
- [container-lifecycle.md](./container-lifecycle.md)
