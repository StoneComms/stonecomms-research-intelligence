import fs from 'node:fs'
import path from 'node:path'
import {uploadImageToSanity} from './media-bridge.mjs'

const endpoint = 'https://api.buffer.com'
const token = process.env.BUFFER_API_KEY
if (!token) throw new Error('BUFFER_API_KEY is not configured')

const CHANNELS = {
  linkedin: '6a8f2c7dccaf649a671fe0fe',
  instagram: '6a8f2d74ccaf649a671fead7',
  x: '6a8f300cccaf649a671ffcd5',
}

const LINKEDIN_MIN_SPACING_MS = 48 * 60 * 60 * 1000

async function gql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
    body: JSON.stringify({query, variables}),
  })
  const payload = await response.json()
  if (!response.ok || payload.errors?.length) throw new Error(JSON.stringify(payload.errors || payload))
  return payload.data
}

async function buildAssets(media) {
  if (!Array.isArray(media) || media.length === 0) return undefined
  const assets = []
  for (let index = 0; index < media.length; index++) {
    const item = media[index]
    if (item.type && item.type !== 'image') throw new Error(`media[${index}].type '${item.type}' is not supported yet; use image`)
    let url = item.url
    if (!url && item.dataBase64) {
      const uploaded = await uploadImageToSanity(item)
      url = uploaded.url
    }
    if (!url || typeof url !== 'string' || !url.startsWith('https://')) throw new Error(`media[${index}] requires a public HTTPS URL or dataBase64 image`)
    const image = {url}
    if (item.alt) image.metadata = {altText: String(item.alt)}
    assets.push({image})
  }
  return assets
}

function normalizeUrl(value) {
  if (!value || typeof value !== 'string') return null
  try {
    const url = new URL(value)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    if (url.hostname.startsWith('www.')) url.hostname = url.hostname.slice(4)
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return `${url.hostname}${url.pathname}${url.search}`
  } catch {
    return null
  }
}

function extractHttpsUrls(text) {
  return String(text || '').match(/https:\/\/[^\s)\]}>,]+/g) || []
}

function dedupeKeys(request) {
  const values = [request.articleUrl, ...(Array.isArray(request.dedupeUrls) ? request.dedupeUrls : []), ...extractHttpsUrls(request.text)]
  return [...new Set(values.map(normalizeUrl).filter(Boolean))]
}

async function discoverBufferContext() {
  const orgData = await gql(`query { account { organizations { id name } } }`)
  for (const organization of orgData.account.organizations) {
    const channelData = await gql(`query GetChannels($organizationId: OrganizationId!) {
      channels(input: {organizationId: $organizationId}) { id name displayName service }
    }`, {organizationId: organization.id})
    const ids = new Set(channelData.channels.map(channel => channel.id))
    if (Object.values(CHANNELS).some(channelId => ids.has(channelId))) return {organizationId: organization.id, channels: channelData.channels}
  }
  throw new Error('Could not find the configured StoneComms Buffer channels in any accessible organization')
}

async function fetchChannelPosts(organizationId, channelId) {
  const posts = []
  let after = null
  do {
    const data = await gql(`query GetPosts($input: PostsInput!, $first: Int, $after: String) {
      posts(input: $input, first: $first, after: $after) {
        edges { cursor node { id text dueAt sentAt status externalLink shareMode } }
        pageInfo { endCursor hasNextPage }
      }
    }`, {
      input: {organizationId, filter: {channelIds: [channelId]}},
      first: 100,
      after,
    })
    posts.push(...data.posts.edges.map(edge => edge.node))
    after = data.posts.pageInfo.hasNextPage ? data.posts.pageInfo.endCursor : null
  } while (after)
  return posts
}

function findDuplicate(request, posts) {
  const keys = dedupeKeys(request)
  const normalizedText = String(request.text || '').trim()
  for (const post of posts) {
    if (normalizedText && String(post.text || '').trim() === normalizedText) return post
    if (keys.length === 0) continue
    const postKeys = extractHttpsUrls(post.text).map(normalizeUrl).filter(Boolean)
    if (post.externalLink) postKeys.push(normalizeUrl(post.externalLink))
    if (keys.some(key => postKeys.includes(key))) return post
  }
  return null
}

function parseScheduledFor(file, request) {
  if (!request.scheduledFor) return null
  const timestamp = Date.parse(request.scheduledFor)
  if (!Number.isFinite(timestamp)) throw new Error(`${file}: scheduledFor must be a valid ISO 8601 date-time`)
  return {iso: new Date(timestamp).toISOString(), timestamp}
}

function enforceLinkedInSpacing(file, scheduled, posts) {
  if (!scheduled) return
  for (const post of posts) {
    const adjacent = post.dueAt || post.sentAt
    if (!adjacent) continue
    const timestamp = Date.parse(adjacent)
    if (!Number.isFinite(timestamp)) continue
    const gap = Math.abs(timestamp - scheduled.timestamp)
    if (gap < LINKEDIN_MIN_SPACING_MS) {
      throw new Error(`${file}: scheduledFor ${scheduled.iso} is less than 48 hours from LinkedIn post ${post.id} at ${new Date(timestamp).toISOString()}`)
    }
  }
}

function nthIndexOf(text, search, occurrence) {
  let start = -1
  let from = 0
  for (let count = 0; count < occurrence; count++) {
    start = text.indexOf(search, from)
    if (start === -1) return -1
    from = start + search.length
  }
  return start
}

function buildLinkedInAnnotations(file, text, mentions) {
  if (!Array.isArray(mentions) || mentions.length === 0) return undefined
  return mentions.map((mention, index) => {
    const required = ['id', 'entity', 'link', 'localizedName', 'vanityName']
    for (const field of required) {
      if (!mention[field] || typeof mention[field] !== 'string') throw new Error(`${file}: linkedinMentions[${index}].${field} is required`)
    }
    const match = String(mention.text || mention.localizedName)
    const occurrence = Number.isInteger(mention.occurrence) && mention.occurrence > 0 ? mention.occurrence : 1
    const start = Number.isInteger(mention.start) ? mention.start : nthIndexOf(text, match, occurrence)
    if (start < 0 || text.slice(start, start + match.length) !== match) {
      throw new Error(`${file}: linkedinMentions[${index}] could not be matched exactly in final post text`)
    }
    return {
      id: mention.id,
      entity: mention.entity,
      link: mention.link,
      localizedName: mention.localizedName,
      vanityName: mention.vanityName,
      start,
      length: match.length,
    }
  })
}

function buildMetadata(file, request, channelName, assets) {
  if (channelName !== 'linkedin') return undefined
  const annotations = buildLinkedInAnnotations(file, request.text, request.linkedinMentions)
  const linkedin = {}
  if (annotations) linkedin.annotations = annotations
  if (request.firstComment) linkedin.firstComment = String(request.firstComment)
  const linkUrl = request.linkAttachment?.url || request.articleUrl
  if (linkUrl && !assets) {
    if (!normalizeUrl(linkUrl)) throw new Error(`${file}: link attachment must use a valid URL`)
    linkedin.linkAttachment = {
      url: linkUrl,
      ...(request.linkAttachment?.title ? {title: String(request.linkAttachment.title)} : {}),
      ...(request.linkAttachment?.description ? {description: String(request.linkAttachment.description)} : {}),
      ...(request.linkAttachment?.thumbnailUrl ? {thumbnail: {url: String(request.linkAttachment.thumbnailUrl)}} : {}),
    }
  }
  return Object.keys(linkedin).length ? {linkedin} : undefined
}

function markProcessed(filePath, request, results, duplicate = false) {
  const next = {
    ...request,
    status: 'processed',
    processedAt: new Date().toISOString(),
    duplicate,
    results,
  }
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`)
}

const dir = 'social-outbox'
if (!fs.existsSync(dir)) process.exit(0)

const {organizationId} = await discoverBufferContext()
const channelPostCache = new Map()
async function postsFor(channelId) {
  if (!channelPostCache.has(channelId)) channelPostCache.set(channelId, await fetchChannelPosts(organizationId, channelId))
  return channelPostCache.get(channelId)
}

const files = fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort()
for (const file of files) {
  const filePath = path.join(dir, file)
  const request = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (request.status !== 'ready') continue

  const channels = request.channels
  if (!request.text || !Array.isArray(channels) || channels.length === 0) throw new Error(`${file}: text and channels are required`)
  if (request.articleUrl && !normalizeUrl(request.articleUrl)) throw new Error(`${file}: articleUrl must be a valid URL`)

  const resolved = channels.map(name => {
    const normalized = String(name).toLowerCase()
    const channelId = CHANNELS[normalized]
    if (!channelId) throw new Error(`${file}: unknown channel '${name}'. Use linkedin, instagram, or x.`)
    return {name: normalized, channelId}
  })

  const assets = await buildAssets(request.media)
  const scheduled = parseScheduledFor(file, request)
  const results = []
  let allDuplicate = true

  for (const {name, channelId} of resolved) {
    const existingPosts = await postsFor(channelId)
    const duplicate = findDuplicate(request, existingPosts)
    if (duplicate) {
      console.log(`Duplicate suppressed for ${file} on ${name}: ${duplicate.id}`)
      results.push({channel: name, status: 'duplicate', postId: duplicate.id, dueAt: duplicate.dueAt || null, sentAt: duplicate.sentAt || null})
      continue
    }

    allDuplicate = false
    if (name === 'linkedin') enforceLinkedInSpacing(file, scheduled, existingPosts)

    const metadata = buildMetadata(file, request, name, assets)
    const mode = scheduled ? 'customScheduled' : (request.mode || 'addToQueue')
    if (scheduled && request.mode && request.mode !== 'customScheduled') throw new Error(`${file}: scheduledFor requires mode 'customScheduled' or no mode`)

    const input = {
      text: request.text,
      channelId,
      schedulingType: 'automatic',
      mode,
      aiAssisted: true,
      ...(scheduled ? {dueAt: scheduled.iso} : {}),
      ...(assets ? {assets} : {}),
      ...(metadata ? {metadata} : {}),
    }

    const data = await gql(`mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id text dueAt sentAt status shareMode assets { id mimeType } } }
        ... on MutationError { message }
      }
    }`, {input})
    if (data.createPost?.message) throw new Error(`${file}: ${data.createPost.message}`)
    const post = data.createPost?.post
    if (!post?.id) throw new Error(`${file}: Buffer did not return a post id`)

    existingPosts.push(post)
    results.push({channel: name, status: 'created', postId: post.id, dueAt: post.dueAt || null, sentAt: post.sentAt || null})
    console.log(`Queued ${file} on ${name}: ${post.id}${post.dueAt ? ` for ${post.dueAt}` : ''}`)
  }

  markProcessed(filePath, request, results, allDuplicate)
}
