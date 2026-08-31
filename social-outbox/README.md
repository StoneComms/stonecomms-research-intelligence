# StoneComms social outbox

Approved social posts are handed to Buffer by adding a JSON file to this directory.

The GitHub Actions workflow publishes `status: ready` requests, then rewrites successfully handled files to `status: processed` with Buffer receipts. Before creating a post, the publisher also checks Buffer for an existing matching post so a retry or failed state commit does not normally create a duplicate.

## Required fields

- `text`: final platform-ready post copy
- `channels`: one or more simple StoneComms destination names: `linkedin`, `instagram`, `x`
- `status`: use `ready`; every other value is ignored

## Strongly recommended for research posts

- `articleUrl`: the canonical public StoneComms research URL. This is used for duplicate detection and, for LinkedIn posts without separate media, as the link-preview attachment.
- `scheduledFor`: ISO 8601 date-time for an explicit fixed publication time. When supplied, the publisher uses Buffer `customScheduled` mode and sends this value as `dueAt`.

For StoneComms LinkedIn, fixed-time posts are protected by a hard 48-hour spacing check against the LinkedIn Page posts currently visible through Buffer. A request that would sit less than 48 hours from another LinkedIn Page post is rejected rather than silently moved.

## Optional fields

- `mode`: `addToQueue` (default), `shareNow`, `shareNext`, or `customScheduled`. If `scheduledFor` is present, omit `mode` or set it to `customScheduled`.
- `dedupeUrls`: additional URLs that should identify an existing matching post.
- `media`: image assets to attach. Each item must contain a public HTTPS `url`; `type` may be `image`; `alt` is recommended.
- `linkAttachment`: optional LinkedIn link-preview details. `articleUrl` is used as the URL by default when no media is attached. Supported fields are `url`, `title`, `description`, and `thumbnailUrl`.
- `firstComment`: optional LinkedIn first comment.
- `linkedinMentions`: verified LinkedIn entity annotations. Never guess these values.

## LinkedIn mentions

A plain `@Name` in post text is not treated as a reliable LinkedIn mention by this bridge. For a genuine LinkedIn mention, add a verified entity record to `linkedinMentions`.

Each mention requires:

- `id`: LinkedIn entity ID
- `entity`: LinkedIn URN, for example `urn:li:organization:1521226`
- `link`: canonical LinkedIn profile or company URL
- `localizedName`: LinkedIn display name
- `vanityName`: LinkedIn vanity name

The publisher locates the mention text in the final post and calculates Buffer's `start` and `length` annotation fields automatically. By default it matches `localizedName`. Use optional `text` when the exact visible text differs, and optional `occurrence` (1-based) when the same visible name appears more than once. An explicit `start` may also be supplied, but the bridge still validates that the final text matches exactly at that position.

If an entity cannot be positively resolved, leave it as ordinary natural-language text and omit it from `linkedinMentions`.

## Research LinkedIn example

```json
{
  "status": "ready",
  "channels": ["linkedin"],
  "articleUrl": "https://www.stonecomms.com/research/example-research-slug",
  "scheduledFor": "2026-09-02T12:00:00+01:00",
  "text": "Final approved LinkedIn copy mentioning IFC - International Finance Corporation naturally in the text.\n\nRead the full StoneComms research: https://www.stonecomms.com/research/example-research-slug\n\n#AfricanInfrastructure #ClimateFinance",
  "linkedinMentions": [
    {
      "id": "1521226",
      "entity": "urn:li:organization:1521226",
      "link": "https://www.linkedin.com/company/example",
      "localizedName": "IFC - International Finance Corporation",
      "vanityName": "example",
      "text": "IFC - International Finance Corporation"
    }
  ]
}
```

The example annotation values above are structural examples only. Automated tasks must supply verified current LinkedIn entity data for real posts.

## Text-only queue example

```json
{
  "status": "ready",
  "mode": "addToQueue",
  "channels": ["linkedin"],
  "text": "Final approved social copy"
}
```

## Image example

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

LinkedIn link attachments and non-empty media arrays are mutually exclusive in Buffer. The bridge therefore uses `articleUrl` as a LinkedIn link attachment only when no media has been supplied.

Media URLs must be publicly reachable over HTTPS so Buffer can fetch them. Do not use local file paths or temporary agent-session paths.

Do not discover, store, or submit raw Buffer channel IDs. The publishing script resolves the simple names internally.

Never place Buffer API keys or other credentials in this directory. The publishing workflow reads `BUFFER_API_KEY` from GitHub Actions secrets.

## Processing and retry safety

After successful creation, or after an existing matching Buffer post is found, the request is rewritten with:

- `status: processed`
- `processedAt`
- `duplicate`
- `results` containing the Buffer post ID and scheduling/sent timestamps where available

The workflow commits these state changes back to the repository with a CI-skipping commit. If publication succeeds but that state commit fails, the next run checks Buffer before creating anything and suppresses a matching duplicate using exact post text and normalized article/dedupe URLs.
