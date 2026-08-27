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

const dir = 'social-outbox'
if (!fs.existsSync(dir)) process.exit(0)
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
for (const file of files) {
  const request = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
  if (request.status && request.status !== 'ready') continue
  const channels = request.channels
  if (!request.text || !Array.isArray(channels) || channels.length === 0) throw new Error(`${file}: text and channels are required`)
  const resolved = channels.map(name => {
    const normalized = String(name).toLowerCase()
    const channelId = CHANNELS[normalized]
    if (!channelId) throw new Error(`${file}: unknown channel '${name}'. Use linkedin, instagram, or x.`)
    return {name: normalized, channelId}
  })
  const assets = await buildAssets(request.media)
  for (const {name, channelId} of resolved) {
    const input = {text: request.text, channelId, schedulingType: 'automatic', mode: request.mode || 'addToQueue', aiAssisted: true, ...(assets ? {assets} : {})}
    const data = await gql(`mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id text dueAt assets { id mimeType } } } ... on MutationError { message } } }`, {input})
    if (data.createPost?.message) throw new Error(`${file}: ${data.createPost.message}`)
    console.log(`Queued ${file} on ${name}: ${data.createPost?.post?.id || 'created'}`)
  }
}
