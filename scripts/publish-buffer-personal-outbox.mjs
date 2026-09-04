import fs from 'node:fs'
import path from 'node:path'

const endpoint = 'https://api.buffer.com'
const token = process.env.BUFFER_API_KEY
if (!token) throw new Error('BUFFER_API_KEY is not configured')

const ACTIVE_POST_STATUSES = ['scheduled', 'sending', 'sent']
const TARGET_NAME = 'lee breheny'

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

function normalizeUrl(value) {
  if (!value || typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
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
  const values = [
    ...(Array.isArray(request.dedupeUrls) ? request.dedupeUrls : []),
    ...extractHttpsUrls(request.text),
  ]
  return [...new Set(values.map(normalizeUrl).filter(Boolean))]
}

async function discoverLeeChannel() {
  const orgData = await gql(`query { account { organizations { id name } } }`)
  const matches = []
  for (const organization of orgData.account.organizations) {
    const channelData = await gql(`query GetChannels($organizationId: OrganizationId!) {
      channels(input: {organizationId: $organizationId}) {
        id
        name
        displayName
        service
      }
    }`, {organizationId: organization.id})

    for (const channel of channelData.channels) {
      const service = String(channel.service || '').toLowerCase()
      const names = [channel.name, channel.displayName].map(v => String(v || '').trim().toLowerCase())
      if (service.includes('linkedin') && names.includes(TARGET_NAME)) {
        matches.push({organizationId: organization.id, channelId: channel.id})
      }
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one LinkedIn Buffer channel matching Lee Breheny; found ${matches.length}`)
  }
  return matches[0]
}

async function fetchPosts(organizationId, channelId) {
  const posts = []
  let after = null
  do {
    const data = await gql(`query GetPosts($input: PostsInput!, $first: Int, $after: String) {
      posts(input: $input, first: $first, after: $after) {
        edges { cursor node { id text dueAt sentAt status externalLink shareMode } }
        pageInfo { endCursor hasNextPage }
      }
    }`, {
      input: {organizationId, filter: {channelIds: [channelId], status: ACTIVE_POST_STATUSES}},
      first: 100,
      after,
    })
    posts.push(...data.posts.edges.map(edge => edge.node))
    after = data.posts.pageInfo.hasNextPage ? data.posts.pageInfo.endCursor : null
  } while (after)
  return posts
}

function findDuplicate(request, posts) {
  const normalizedText = String(request.text || '').trim()
  const keys = dedupeKeys(request)
  for (const post of posts) {
    if (normalizedText && String(post.text || '').trim() === normalizedText) return post
    const postKeys = extractHttpsUrls(post.text).map(normalizeUrl).filter(Boolean)
    if (post.externalLink) postKeys.push(normalizeUrl(post.externalLink))
    if (keys.length && keys.some(key => postKeys.includes(key))) return post
  }
  return null
}

function parseScheduledFor(file, request) {
  if (!request.scheduledFor) throw new Error(`${file}: scheduledFor is required`)
  const timestamp = Date.parse(request.scheduledFor)
  if (!Number.isFinite(timestamp)) throw new Error(`${file}: scheduledFor must be valid ISO 8601`)
  return new Date(timestamp).toISOString()
}

function markProcessed(filePath, request, result, duplicate) {
  fs.writeFileSync(filePath, `${JSON.stringify({
    ...request,
    status: 'processed',
    processedAt: new Date().toISOString(),
    duplicate,
    result,
  }, null, 2)}\n`)
}

const dir = 'personal-social-outbox'
if (!fs.existsSync(dir)) process.exit(0)

const {organizationId, channelId} = await discoverLeeChannel()
const existingPosts = await fetchPosts(organizationId, channelId)
const files = fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort()

for (const file of files) {
  const filePath = path.join(dir, file)
  const request = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (request.status !== 'ready') continue
  if (!request.text || typeof request.text !== 'string') throw new Error(`${file}: text is required`)

  const duplicate = findDuplicate(request, existingPosts)
  if (duplicate) {
    markProcessed(filePath, request, {
      status: 'duplicate',
      postId: duplicate.id,
      dueAt: duplicate.dueAt || null,
      sentAt: duplicate.sentAt || null,
      externalLink: duplicate.externalLink || null,
    }, true)
    console.log(`Duplicate suppressed for ${file}: ${duplicate.id}`)
    continue
  }

  const dueAt = parseScheduledFor(file, request)
  const input = {
    text: request.text,
    channelId,
    schedulingType: 'automatic',
    mode: 'customScheduled',
    dueAt,
    aiAssisted: true,
  }

  const data = await gql(`mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess { post { id text dueAt sentAt status externalLink shareMode } }
      ... on MutationError { message }
    }
  }`, {input})

  if (data.createPost?.message) throw new Error(`${file}: ${data.createPost.message}`)
  const post = data.createPost?.post
  if (!post?.id) throw new Error(`${file}: Buffer did not return a post id`)

  existingPosts.push(post)
  markProcessed(filePath, request, {
    status: 'created',
    postId: post.id,
    dueAt: post.dueAt || null,
    sentAt: post.sentAt || null,
    externalLink: post.externalLink || null,
  }, false)
  console.log(`Queued ${file}: ${post.id} for ${post.dueAt || dueAt}`)
}
