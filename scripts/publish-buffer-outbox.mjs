import fs from 'node:fs'
import path from 'node:path'

const endpoint = 'https://api.buffer.com'
const token = process.env.BUFFER_API_KEY
if (!token) throw new Error('BUFFER_API_KEY is not configured')

const CHANNELS = {
  linkedin: '6a8f2c7dccaf649a671fe0fe',
  instagram: '6a8f2d74ccaf649a671fead7',
  x: '6a8f300cccaf649a671ffcd5',
}

async function gql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
    body: JSON.stringify({query, variables}),
  })
  const payload = await response.json()
  if (!response.ok || payload.errors?.length) {
    throw new Error(JSON.stringify(payload.errors || payload))
  }
  return payload.data
}

const dir = 'social-outbox'
if (!fs.existsSync(dir)) process.exit(0)

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
for (const file of files) {
  const request = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
  if (request.status && request.status !== 'ready') continue

  const channels = request.channels
  if (!request.text || !Array.isArray(channels) || channels.length === 0) {
    throw new Error(`${file}: text and channels are required`)
  }

  const resolved = channels.map(name => {
    const normalized = String(name).toLowerCase()
    const channelId = CHANNELS[normalized]
    if (!channelId) throw new Error(`${file}: unknown channel '${name}'. Use linkedin, instagram, or x.`)
    return {name: normalized, channelId}
  })

  for (const {name, channelId} of resolved) {
    const data = await gql(`mutation CreatePost($text: String!, $channelId: ID!, $mode: PostMode!) {
      createPost(input: {text: $text, channelId: $channelId, schedulingType: automatic, mode: $mode}) {
        ... on PostActionSuccess { post { id text dueAt } }
        ... on MutationError { message }
      }
    }`, {text: request.text, channelId, mode: request.mode || 'addToQueue'})
    if (data.createPost?.message) throw new Error(`${file}: ${data.createPost.message}`)
    console.log(`Queued ${file} on ${name}: ${data.createPost?.post?.id || 'created'}`)
  }
}
