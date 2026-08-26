import fs from 'node:fs'
import path from 'node:path'

const endpoint = 'https://api.buffer.com'
const token = process.env.BUFFER_API_KEY
if (!token) throw new Error('BUFFER_API_KEY is not configured')

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
  if (!request.text || !Array.isArray(request.channelIds) || request.channelIds.length === 0) {
    throw new Error(`${file}: text and channelIds are required`)
  }

  for (const channelId of request.channelIds) {
    const data = await gql(`mutation CreatePost($text: String!, $channelId: ID!, $mode: PostMode!) {
      createPost(input: {text: $text, channelId: $channelId, schedulingType: automatic, mode: $mode}) {
        ... on PostActionSuccess { post { id text dueAt } }
        ... on MutationError { message }
      }
    }`, {text: request.text, channelId, mode: request.mode || 'addToQueue'})
    if (data.createPost?.message) throw new Error(`${file}: ${data.createPost.message}`)
    console.log(`Queued ${file} on ${channelId}: ${data.createPost?.post?.id || 'created'}`)
  }
}
