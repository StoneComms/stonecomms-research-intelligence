# StoneComms social outbox

Approved social posts are handed to Buffer by adding a JSON file to this directory.

Required fields:
- `text`: final platform-ready post copy
- `channels`: one or more simple StoneComms destination names: `linkedin`, `instagram`, `x`

Optional fields:
- `mode`: `addToQueue` (default), `shareNow`, or `shareNext`
- `status`: use `ready`; any other value is ignored

Example:

```json
{
  "status": "ready",
  "mode": "addToQueue",
  "channels": ["linkedin"],
  "text": "Final approved social copy"
}
```

For platform-specific copy, create separate JSON requests for each destination rather than sending identical copy to every channel.

Do not discover, store, or submit raw Buffer channel IDs. The publishing script resolves the simple names internally.

Never place Buffer API keys or other credentials in this directory. The publishing workflow reads `BUFFER_API_KEY` from GitHub Actions secrets.
