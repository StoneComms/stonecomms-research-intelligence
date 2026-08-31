import fs from 'node:fs'
import crypto from 'node:crypto'

const WEBFLOW_API = 'https://api.webflow.com/v2'
const PUBLIC_SITE_ORIGIN = 'https://stonecomms.com'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }
  return body
}

function loadManifest() {
  const manifestPath = process.env.PUBLICATION_MANIFEST_PATH || process.argv[2]
  if (!manifestPath) throw new Error('Provide PUBLICATION_MANIFEST_PATH or a manifest path argument')
  return { manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) }
}

function validateManifest(manifest) {
  if (!/^[a-f0-9]{24}$/i.test(manifest.collectionId || '')) throw new Error('Manifest requires a valid collectionId')
  if (!manifest.fieldData || typeof manifest.fieldData !== 'object' || Array.isArray(manifest.fieldData)) throw new Error('Manifest requires fieldData')
  if (!manifest.fieldData.name || !manifest.fieldData.slug) throw new Error('fieldData requires name and slug')
  if (manifest.fieldData['hero-image'] !== undefined || manifest.fieldData.pdf !== undefined) {
    throw new Error('hero-image and pdf must be omitted; these assets are attached manually in Webflow')
  }
  if (manifest.liveUrl && !/^https:\/\//.test(manifest.liveUrl)) throw new Error('liveUrl must use HTTPS')
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

async function listAllItems(collectionId, token) {
  const items = []
  let offset = 0
  const limit = 100
  while (true) {
    const url = new URL(`${WEBFLOW_API}/collections/${collectionId}/items`)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('offset', String(offset))
    const page = await fetchJson(url, { headers: headers(token) })
    items.push(...(page?.items || []))
    const total = Number(page?.pagination?.total ?? items.length)
    if (items.length >= total || !(page?.items || []).length) break
    offset += limit
  }
  return items
}

async function verifyPublicPage(liveUrl, expectedTitle, attempts = 15) {
  if (!liveUrl) return { checked: false }
  let lastStatus = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const url = new URL(liveUrl)
      url.searchParams.set('wfverify', `${Date.now()}-${attempt}`)
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' },
      })
      lastStatus = response.status
      const html = await response.text()
      if (response.ok && (html.includes(expectedTitle) || html.includes(new URL(liveUrl).pathname))) {
        return { checked: true, status: response.status, attempts: attempt }
      }
    } catch {
      // Retry while Webflow publishes and its CDN updates.
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(2000 * attempt, 10000)))
  }
  throw new Error(`Live page verification failed after ${attempts} attempts (last status: ${lastStatus ?? 'unavailable'})`)
}

function writeGithubOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  const marker = `EOF_${crypto.randomBytes(8).toString('hex')}`
  fs.appendFileSync(output, `${name}<<${marker}\n${value}\n${marker}\n`)
}

const token = requiredEnv('WEBFLOW_API_TOKEN')
const { manifestPath, manifest } = loadManifest()
validateManifest(manifest)

const collectionId = manifest.collectionId
const canonicalUrl = `${PUBLIC_SITE_ORIGIN}/research/${encodeURIComponent(manifest.fieldData.slug)}`
const fieldData = {
  ...manifest.fieldData,
  'article-url': canonicalUrl,
}
const existing = (await listAllItems(collectionId, token)).filter(item => item?.fieldData?.slug === fieldData.slug)
if (existing.length > 1) throw new Error(`Found ${existing.length} items with slug ${fieldData.slug}; refusing an ambiguous update`)

let item
let operation
if (existing.length === 1) {
  operation = 'updated'
  item = await fetchJson(`${WEBFLOW_API}/collections/${collectionId}/items/${existing[0].id}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ isDraft: true, isArchived: false, fieldData }),
  })
} else {
  operation = 'created'
  item = await fetchJson(`${WEBFLOW_API}/collections/${collectionId}/items`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ isDraft: true, isArchived: false, fieldData }),
  })
}

const itemId = item?.id || item?.items?.[0]?.id || existing[0]?.id
if (!itemId) throw new Error('Webflow did not return a CMS item ID')

await fetchJson(`${WEBFLOW_API}/collections/${collectionId}/items/publish`, {
  method: 'POST',
  headers: headers(token),
  body: JSON.stringify({ itemIds: [itemId] }),
})

const verified = await fetchJson(`${WEBFLOW_API}/collections/${collectionId}/items/${itemId}`, {
  headers: headers(token),
})
if (verified?.fieldData?.slug !== fieldData.slug) throw new Error('Staged verification returned the wrong slug')
if (!verified?.lastPublished) throw new Error('Webflow item has no lastPublished timestamp after publication')
if (verified?.fieldData?.['article-url'] !== canonicalUrl) throw new Error('Webflow item does not contain the canonical production article URL')

const publicVerification = await verifyPublicPage(canonicalUrl, fieldData.name)
const result = {
  operation,
  collectionId,
  itemId,
  slug: fieldData.slug,
  name: fieldData.name,
  liveUrl: canonicalUrl,
  lastPublished: verified.lastPublished,
  isDraft: verified.isDraft,
  manualAssetFieldsIntentionallyOmitted: ['hero-image', 'pdf'],
  publicVerification,
  manifestPath,
}

const outputPath = process.env.WEBFLOW_PUBLICATION_OUTPUT_PATH || 'webflow-publication-result.json'
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
writeGithubOutput('publication_result', JSON.stringify(result))
writeGithubOutput('publication_result_path', outputPath)
console.log(JSON.stringify(result, null, 2))
