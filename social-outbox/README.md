# StoneComms social outbox

Approved social posts are handed to Buffer by adding a JSON file to this directory.

Required fields:
- `text`: final platform-ready post copy
- `channels`: one or more simple StoneComms destination names: `linkedin`, `instagram`, `x`

Optional fields:
- `mode`: `addToQueue` (default), `shareNow`, or `shareNext`
- `status`: use `ready`; any other value is ignored
- `media`: image assets to attach to the post. Each item must contain a public HTTPS `url`; `type` may be `image`; `alt` is recommended.

Text-only example:

```json
{
  "status": "ready",
  "mode": "addToQueue",
  "channels": ["linkedin"],
  "text": "Final approved social copy"
}
```

Image example:

```json
{
  "status": "ready",
  "mode": "addToQueue",
  "channels": ["linkedin"],
  "text": "Final approved social copy",
  "media": [
    {
      "type": "image",
      "url": "https://www.stonecomms.com/path/to/public-image.png",
      "alt": "Concise description of the StoneComms research illustration"
    }
  ]
}
```

For platform-specific copy, create separate JSON requests for each destination rather than sending identical copy to every channel.

For LinkedIn and X, media is optional and should be used when it strengthens the communication. Instagram should normally include media.

Media URLs must be publicly reachable over HTTPS so Buffer can fetch them. Do not use local file paths or temporary agent-session paths.

Do not discover, store, or submit raw Buffer channel IDs. The publishing script resolves the simple names internally.

Never place Buffer API keys or other credentials in this directory. The publishing workflow reads `BUFFER_API_KEY` from GitHub Actions secrets.
