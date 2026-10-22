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

## Research attribution and UTM convention

Keep `articleUrl` clean and canonical. Never add tracking parameters to `articleUrl`, because it is also used for duplicate detection.

For every new research social post, create a separate tracked destination URL using:

- `utm_source`: the platform, for example `linkedin`
- `utm_medium`: `organic_social`
- `utm_campaign`: the exact StoneComms research slug
- `utm_content`: a unique post identifier, normally `<YYYY-MM-DD>-main-post`; use a different value for later reposts, personal roundups, or variants

Example:

`https://stonecomms.com/research/example-research-slug?utm_source=linkedin&utm_medium=organic_social&utm_campaign=example-research-slug&utm_content=2026-09-02-main-post`

For LinkedIn posts without separate media, set `linkAttachment.url` to the tracked URL while leaving `articleUrl` canonical. If a non-empty `media` array is used, do not add `linkAttachment`; use the tracked URL in the visible post text instead. LinkedIn link attachments and non-empty media arrays are mutually exclusive in Buffer.

This convention is intended to preserve robust Buffer deduplication while allowing GA4 or another analytics layer to attribute visits to an individual report and social post once analytics is enabled.

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
  "text": "Final approved LinkedIn copy mentioning IFC - International Finance Corporation naturally in the text.\n\nRead the full StoneComms research: https://www.stonecomms.com/research/example-research-slug?utm_source=linkedin&utm_medium=organic_social&utm_campaign=example-research-slug&utm_content=2026-09-02-main-post\n\n#AfricanInfrastructure #ClimateFinance",
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


## StoneComms company LinkedIn hero image requirement (20 October 2026)

For all NEW StoneComms research-promotion posts on the official LinkedIn company page, attaching the exact published report's approved hero illustration is MANDATORY. This instruction supersedes the earlier statement that LinkedIn media is optional for research posts. Do not rely on LinkedIn automatically generating a thumbnail from link/Open Graph metadata: it has resulted in posts without the intended report image.

Before creating a new social-outbox request:
1. Retrieve the specific article's approved final hero image from the live Webflow Research CMS item or the permanent company-owned GitHub media asset bridge. Positively match it to the report (not a generic illustration or logo).
2. Confirm the image URL is stable, publicly readable HTTPS and that the file actually returns an image. Never use ChatGPT session, expiring, signed, private or staging image URLs.
3. Set a non-empty media array, using { "type": "image", "url": "https://...permanent-image...", "alt": "Accurate visual description" }.
4. Since Buffer cannot combine LinkedIn media and linkAttachment, OMIT linkAttachment entirely and put the canonical article URL with proper LinkedIn UTM tracking visibly in the post text. Keep articleUrl clean and canonical for deduplication.
5. Before writing to GitHub, check that image URL, alt text, report URL and linked report all match. If the approved image is missing, inaccessible or uncertain, STOP that individual post, report a clearly labelled IMAGE BLOCKER and do not publish it as text-only or invent artwork. Continue with other valid posts only if sequence and 48-hour spacing remain safe.
6. Do not retrofit processed requests or duplicate any existing Buffer post. Reconcile live LinkedIn state, Buffer state, ready/processed company outbox and personal-social-outbox before catching up. A processed receipt confirms Buffer acceptance, NOT necessarily that LinkedIn published on its dueAt. Verify actual published state when claiming publication.

Personal weekly LinkedIn roundups remain separate under personal-social-outbox/; do not alter their identity, schedule or deduplication rules. The above image rule applies to company research-promotion posts, not necessarily to the editorial personal roundup.


## Automatic publishing handoff (22 October 2026)

The company workflow now runs after a successful production Webflow research workflow and daily at 08:15 UTC. It scans Research manifests, skips articles reserved by either existing requests or matching Buffer posts, checks the live article and its exact hero, and prepares missing promotions from the already published title and standfirst. Posts use fixed 11:00 Europe/London slots at least 48 elapsed hours apart, including clock changes. The publisher validates the same image bytes again immediately before Buffer submission. An image blocker affects that article only; no replacement artwork or text-only fallback is permitted. Daily scans retry articles whose manually attached Webflow hero was not ready when the text publication completed.

The personal workflow prepares Friday 11:00 Europe/London roundups on Thursday, with a Friday retry. It uses only company posts with Buffer `sent` evidence and a LinkedIn publication URL. Unrounded material carries forward after missed weeks. Existing roundup URLs, recorded manual personal coverage and previously previewed material are excluded. The full title and published standfirst are reused without adding unsupported personal observations. Up to three reports fit each roundup; overflow carries forward. Unrecorded personal StoneComms posts block preparation until reconciled, protecting against duplicate coverage when LinkedIn has shortened URLs. The personal identity and Friday schedule remain separate from the company queue.

`social-reconciliation/personal-coverage.json` records verified personal coverage absent from the original dedupe fields. Historical processed requests are preserved. Both workflows persist receipts with push retries and upload a handoff result artifact; Buffer acceptance is still distinct from actual LinkedIn publication. The read-only verification workflow reports full text, attachments, sent timestamps and LinkedIn URLs.
