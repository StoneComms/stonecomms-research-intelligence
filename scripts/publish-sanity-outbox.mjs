import fs from 'node:fs'
import path from 'node:path'
import {uploadImageToSanity} from './media-bridge.mjs'

const projectId = 'poc8ca1r'
const dataset = 'production'
const apiVersion = '2026-08-27'
const token = process.env.SANITY_WRITE_TOKEN
if (!token) throw new Error('SANITY_WRITE_TOKEN is not configured')

const dir = 'sanity-outbox'
if (!fs.existsSync(dir)) process.exit(0)

async function sanity(pathname, options = {}) {
  const res = await fetch(`https://${projectId}.api.sanity.io${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

async function query(query, params = {}) {
  const usp = new URLSearchParams({query})
  for (const [key, value] of Object.entries(params)) usp.set(`$${key}`, JSON.stringify(value))
  const result = await sanity(`/v${apiVersion}/data/query/${dataset}?${usp}`)
  return result.result
}

async function mutate(mutations) {
  return sanity(`/v${apiVersion}/data/mutate/${dataset}?returnIds=true`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({mutations}),
  })
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
for (const file of files) {
  const request = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
  if (request.status && request.status !== 'ready') continue
  if (!request.slug) throw new Error(`${file}: slug is required`)

  const document = await query(
    `*[_type == "publication" && slug.current == $slug][0]{_id,_rev,title}`,
    {slug: request.slug},
  )
  if (!document?._id) throw new Error(`${file}: publication not found for slug ${request.slug}`)

  const set = {}
  if (request.heroImage) {
    const uploaded = await uploadImageToSanity(request.heroImage, token)
    set.heroImage = {
      _type: 'image',
      asset: {_type: 'reference', _ref: uploaded.assetId},
      ...(request.heroImage.alt ? {alt: request.heroImage.alt} : {}),
      ...(request.heroImage.caption ? {caption: request.heroImage.caption} : {}),
      ...(request.heroImage.credit ? {credit: request.heroImage.credit} : {}),
    }
  }

  if (!Object.keys(set).length) throw new Error(`${file}: no supported changes supplied`)

  await mutate([{
    patch: {
      id: document._id,
      set,
      ifRevisionID: document._rev,
    },
  }])

  console.log(`Updated ${document.title || request.slug} from ${file}`)
}
