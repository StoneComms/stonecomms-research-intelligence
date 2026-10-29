import fs from 'node:fs'
import path from 'node:path'
import {matches} from './social-safety.mjs'

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
  const values = Array.isArray(request.dedupeUrls) ? request.dedupeUrls : []
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
  const match = posts.find(post => matches(request, post))
  if (match) return match
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

  // Revision of an existing scheduled Lee post. Never creates a second post.
  if (request.status === 'revise-scheduled') {
    const revision = request.revision
    const postId = revision?.targetPostId
    if (!postId || postId !== request.result?.postId || request.duplicate !== false) {
      throw new Error(`${file}: scheduled revision target does not match the original Buffer receipt`)
    }
    if (typeof revision.expectedPreviousText !== 'string' || !request.text ||
        !Array.isArray(request.dedupeUrls) || request.dedupeUrls.length < 1 ||
        !request.dedupeUrls.every(url => request.text.includes(url))) {
      throw new Error(`${file}: revision content or expected previous text is incomplete`)
    }
    const target = existingPosts.find(post => post.id === postId)
    if (!target) throw new Error(`${file}: scheduled post not found in Lee's verified Buffer channel`)
    const scheduledFor = parseScheduledFor(file, request)
    const scheduleUnchanged = target.status === 'scheduled' &&
      target.sentAt === null && Date.parse(target.dueAt) === Date.parse(scheduledFor)
    if (!scheduleUnchanged) throw new Error(`${file}: scheduled target is not safely editable`)
    if (target.text !== request.text && target.text !== revision.expectedPreviousText) {
      throw new Error(`${file}: Buffer text was changed independently; revision stopped`)
    }

    let revised = target
    if (target.text !== request.text) {
      // Edit only text. Omitting dueAt/mode preserves the exact Friday schedule.
      const data = await gql(`mutation EditPost($input: EditPostInput!) {
        editPost(input: $input) {
          ... on PostActionSuccess { post { id text dueAt sentAt status externalLink shareMode } }
          ... on MutationError { message }
        }
      }`, {input: {id: postId, text: request.text, aiAssisted: true}})
      if (data.editPost?.message) throw new Error(`${file}: Buffer edit rejected: ${data.editPost.message}`)
      revised = data.editPost?.post
      if (!revised?.id || revised.id !== postId || revised.text !== request.text ||
          revised.status !== 'scheduled' || revised.sentAt !== null ||
          Date.parse(revised.dueAt) !== Date.parse(scheduledFor)) {
        throw new Error(`${file}: edit response did not confirm preserved schedule and exact text`)
      }
    }

    // Read back after the edit; a success reply alone is not publication evidence.
    const confirmed = (await fetchPosts(organizationId, channelId)).find(post => post.id === postId)
    if (!confirmed || confirmed.text !== request.text || confirmed.status !== 'scheduled' ||
        confirmed.sentAt !== null || Date.parse(confirmed.dueAt) !== Date.parse(scheduledFor)) {
      throw new Error(`${file}: Buffer readback failed to confirm revised text and schedule`)
    }
    fs.writeFileSync(filePath, JSON.stringify({
      ...request, status: 'processed', editedAt: new Date().toISOString(),
      revision: {...revision, status: 'verified'},
      editResult: {
        status: 'updated', postId, dueAt: confirmed.dueAt,
        bufferStatus: confirmed.status, textVerified: true, duplicateCreated: false
      }
    }, null, 2) + '\\n')
    console.log(`Revised existing Lee Buffer post for ${file}; schedule preserved: ${confirmed.dueAt}`)
    continue
  }

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
  if (request.publishNow !== undefined && typeof request.publishNow !== 'boolean') {
    throw new Error(`${file}: publishNow must be a boolean`)
  }
  // Immediate publishing is opt-in; dated requests keep their existing behaviour.
  const publishNow = request.publishNow === true
  if (!publishNow && Date.parse(dueAt) <= Date.now()) throw new Error(`${file}: refusing past-dated personal request`)
  const input = {
    text: request.text,
    channelId,
    schedulingType: 'automatic',
    mode: publishNow ? 'shareNow' : 'customScheduled',
    ...(publishNow ? {} : {dueAt}),
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
    bufferStatus: post.status || null,
    shareMode: post.shareMode || null,
    postId: post.id,
    dueAt: post.dueAt || null,
    sentAt: post.sentAt || null,
    externalLink: post.externalLink || null,
  }, false)
  console.log(`Submitted ${file}: ${post.id} ${publishNow ? 'for immediate publication' : `for ${post.dueAt || dueAt}`}`)
}
