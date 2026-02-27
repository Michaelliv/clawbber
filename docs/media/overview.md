# Media Handling

BearClaw downloads and processes media attachments from chat platforms, saving them to group workspaces and passing them to pi for processing.

## Supported Platforms

| Platform | Status | Document |
|----------|--------|----------|
| WhatsApp | ✅ Implemented | [whatsapp.md](./whatsapp.md) |
| Slack | ❌ Not yet | — |
| Discord | ❌ Not yet | — |

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────┐
│   Platform   │────▶│   Adapter    │────▶│   Runtime    │────▶│   pi    │
│  (WhatsApp)  │     │ (download)   │     │ (store/pass) │     │ (view)  │
└──────────────┘     └──────────────┘     └──────────────┘     └─────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Workspace   │
                     │   /media/    │
                     └──────────────┘
```

## Media Types

All platforms map to these generic types defined in `src/types.ts`:

```typescript
type MediaType = "image" | "video" | "audio" | "voice" | "document";

interface MessageAttachment {
  path: string;        // Local file path
  type: MediaType;     // Generic type
  mimeType: string;    // MIME type (e.g., "image/jpeg")
  filename?: string;   // Original filename if available
  sizeBytes?: number;  // File size in bytes
}
```

## Configuration

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `BEARCLAW_MEDIA_ENABLED` | `true` | Enable/disable media downloads |
| `BEARCLAW_MEDIA_MAX_SIZE_MB` | `10` | Max file size to download (MB) |

## Storage

Media files are saved to the group workspace:

```
.bearclaw/groups/<group_id>/media/<timestamp>-<type>.<ext>
```

Example:
```
.bearclaw/groups/whatsapp_123456_g_us/media/
├── 1709012345-image.jpg
├── 1709012400-voice.ogg
└── 1709012500-document.pdf
```

## Database Schema

Attachments are stored as JSON in the `messages.attachments` column:

```sql
ALTER TABLE messages ADD COLUMN attachments TEXT;
```

```json
[
  {
    "path": "/Users/.../media/1709012345-image.jpg",
    "type": "image",
    "mimeType": "image/jpeg",
    "sizeBytes": 12345
  }
]
```

## Prompt Format

Attachments are passed to pi as XML:

```xml
<attachments>
  <attachment type="image" path="/groups/xxx/media/123-image.jpg" mime="image/jpeg" size="12345" />
</attachments>

@bearclaw what's in this image?
```

Reply context includes media info:

```xml
<reply_to name="John" jid="123@wa" message_id="ABC" media_type="image" media_mime="image/jpeg">
Check out this sunset!
</reply_to>
```

## pi Capabilities

| Media Type | pi Support |
|------------|------------|
| Images (jpg, png, gif, webp) | ✅ Can view via `read` tool |
| Voice/Audio | ❌ Cannot play — needs transcription |
| Video | ❌ Cannot play — could extract frames |
| Documents (txt, code) | ✅ Can read text-based files |
| Documents (pdf, docx) | ❌ Cannot read binary formats |

## Future Enhancements

- [ ] Voice transcription via OpenAI Whisper
- [ ] Slack file downloads
- [ ] Discord attachment downloads
- [ ] Video frame extraction
- [ ] PDF text extraction
