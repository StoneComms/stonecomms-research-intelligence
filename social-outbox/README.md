# StoneComms social outbox

Approved social posts are handed to Buffer by adding a JSON file to this directory.

Required fields:
- `text`: final platform-ready post copy
- `channelIds`: Buffer channel IDs to receive the post

Optional fields:
- `mode`: `addToQueue` (default), `shareNow`, or `shareNext`
- `status`: use `ready`; any other value is ignored

Example:

```json
{
  "status": "ready",
  "mode": "addToQueue",
  "channelIds": ["BUFFER_CHANNEL_ID"],
  "text": "Final approved social copy"
}
```

Never place Buffer API keys or other credentials in this directory. The publishing workflow reads `BUFFER_API_KEY` from GitHub Actions secrets.
