# Media Handling

Mercury downloads media attachments from chat platforms, saves them to the workspace, and passes them to the agent. The agent can also produce files via the `outbox/` directory.

## Inbox (Incoming)

Incoming media is saved to the workspace:

```
workspace/inbox/<timestamp>-<filename>
```

Examples:
```
workspace/inbox/
├── 1741243200000-photo.jpg
├── 1741243500000-voice.ogg
└── 1741244000000-report.pdf
```

The agent receives attachments as XML in the prompt:

```xml
<attachments>
  <attachment type="image" path="inbox/1741243200000-photo.jpg" mime="image/jpeg" size="12345" />
</attachments>
```

## Outbox (Outgoing)

The agent writes files to `outbox/` during a run. After the agent exits, the runtime scans for files with `mtime >= startTime` and attaches them to the reply:

```
workspace/outbox/
├── chart.png
└── summary.pdf
```

Previous outbox files are not deleted — only files created or modified during the current run are sent.

## Platform-Specific Download

| Platform | Mechanism |
|----------|-----------|
| WhatsApp | Baileys socket `downloadMediaMessage()` |
| Discord | CDN URL download |
| Slack | `url_private` with bot token auth |
| Chat API | Base64 decoded from request body |

## Platform-Specific Upload

| Platform | Mechanism |
|----------|-----------|
| WhatsApp | `sock.sendMessage()` with typed content (image/video/audio/document) |
| Discord | `thread.post({ files })` |
| Slack | `files.uploadV2` API |
| Chat API | Base64 encoded in response body |

## Supported Types

| Type | Extensions |
|------|-----------|
| Image | jpg, png, gif, webp |
| Video | mp4, mov, avi |
| Audio | ogg, mp3, wav, m4a |
| Document | pdf, doc, docx, txt, csv, xls, xlsx |
