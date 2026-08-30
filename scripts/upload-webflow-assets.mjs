import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const WEBFLOW_API = 'https://api.webflow.com/v2'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex')
}

function isMicrosoftHosted(url) {
  const host = new URL(url).hostname.toLowerCase()
  return host.endsWith('.sharepoint.com') || host.endsWith('.1drv.ms') || host.endsWith('.onedrive.live.com')
}

function microsoftDownloadCandidates(sourceUrl) {
  const source = new URL(sourceUrl)
  const candidates = []

  const withDownload = new URL(source)
  if (!withDownload.searchParams.has('download')) withDownload.searchParams.set('download', '1')
  candidates.push(withDownload.toString())

  if (source.hostname.toLowerCase().endsWith('.sharepoint.com')) {
    const parts = source.pathname.split('/').filter(Boolean)
    const shareToken = parts.at(-1)
    const personalIndex = parts.indexOf('personal')
    if (shareToken && personalIndex >= 0 && parts.length > personalIndex + 2) {
      const siteBase = `/${parts.slice(0, personalIndex + 2).join('/')}`
      candidates.push(`${source.origin}${siteBase}/_layouts/15/download.aspx?share=${encodeURIComponent(shareToken)}`)
      candidates.push(`${source.origin}${siteBase}/_layouts/15/guestaccess.aspx?share=${encodeURIComponent(shareToken)}&download=1`)
    }
  }

  return [...new Set(candidates)]
}

function sourceCandidates(sourceUrl) {
  if (!isMicrosoftHosted(sourceUrl)) return [sourceUrl]
  return microsoftDownloadCandidates(sourceUrl)
}

function validateMagic(buffer, contentType, fileName) {
  if (!buffer.length) throw new Error(`${fileName}: downloaded file is empty`)
  const lowerType = (contentType || '').toLowerCase()
  const lowerName = fileName.toLowerCase()

  if (lowerType === 'image/png' || lowerName.endsWith('.png')) {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(png)) throw new Error(`${fileName}: PNG signature validation failed`)
  }

  if (lowerType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`${fileName}: PDF header validation failed`)
    if (!buffer.subarray(Math.max(0, buffer.length - 4096)).includes(Buffer.from('%%EOF'))) throw new Error(`${fileName}: PDF EOF validation failed`)
  }
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

async function downloadAsset(spec) {
  if (!spec.sourceUrl || !spec.fileName) throw new Error('Each asset requires sourceUrl and fileName')

  const attempts = []
  for (const url of sourceCandidates(spec.sourceUrl)) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StoneCommsPublisher/1.0)',
          Accept: '*/*',
        },
      })
      if (!response.ok) {
        attempts.push(`${response.status} ${url}`)
        continue
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const responseType = (response.headers.get('content-type') || '').split(';')[0].trim()
      const contentType = spec.contentType || responseType || 'application/octet-stream'
      validateMagic(buffer, contentType, spec.fileName)

      if (Number.isInteger(spec.expectedBytes) && buffer.length !== spec.expectedBytes) {
        throw new Error(`${spec.fileName}: expected ${spec.expectedBytes} bytes, received ${buffer.length}`)
      }
      const actualSha = sha256(buffer)
      if (spec.sha256 && actualSha !== String(spec.sha256).toLowerCase()) {
        throw new Error(`${spec.fileName}: SHA-256 mismatch (expected ${spec.sha256}, got ${actualSha})`)
      }

      return { buffer, contentType, sha256: actualSha, md5: md5(buffer), sourceUrl: url }
    } catch (error) {
      attempts.push(`${error.message} [${url}]`)
    }
  }

  throw new Error(`${spec.fileName}: all source download methods failed:\n- ${attempts.join('\n- ')}`)
}

async function createWebflowAsset(siteId, token, spec, downloaded) {
  const payload = { fileName: spec.fileName, fileHash: downloaded.md5 }
  if (spec.parentFolder) payload.parentFolder = spec.parentFolder

  const created = await fetchJson(`${WEBFLOW_API}/sites/${siteId}/assets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!created?.id) throw new Error(`${spec.fileName}: Webflow did not return an asset id`)

  if (created.uploadUrl && created.uploadDetails) {
    const form = new FormData()
    for (const [key, value] of Object.entries(created.uploadDetails)) {
      if (value !== undefined && value !== null) form.append(key, String(value))
    }
    const uploadType = created.uploadDetails['content-type'] || created.contentType || downloaded.contentType
    form.append('file', new Blob([downloaded.buffer], { type: uploadType }), spec.fileName)

    const uploadResponse = await fetch(created.uploadUrl, { method: 'POST', body: form, redirect: 'follow' })
    const uploadBody = await uploadResponse.text()
    if (uploadResponse.status !== 201) {
      throw new Error(`${spec.fileName}: Webflow S3 upload failed (${uploadResponse.status}): ${uploadBody.slice(0, 1000)}`)
    }
  }

  return created
}

async function verifyWebflowAsset(assetId, token, expectedBytes, attempts = 12) {
  let last = null
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fetchJson(`${WEBFLOW_API}/assets/${assetId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (last?.hostedUrl && Number(last?.size) === expectedBytes) return last
    } catch (error) {
      if (i === attempts - 1) throw error
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * (i + 1), 5000)))
  }
  throw new Error(`Webflow asset ${assetId} failed verification: expected ${expectedBytes} bytes, got ${last?.size ?? 'unknown'}`)
}

function loadManifest() {
  if (process.env.ASSET_MANIFEST_JSON) return JSON.parse(process.env.ASSET_MANIFEST_JSON)
  const manifestPath = process.env.ASSET_MANIFEST_PATH || process.argv[2]
  if (!manifestPath) throw new Error('Provide ASSET_MANIFEST_JSON, ASSET_MANIFEST_PATH, or a manifest path argument')
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function writeGithubOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  const marker = `EOF_${crypto.randomBytes(8).toString('hex')}`
  fs.appendFileSync(output, `${name}<<${marker}\n${value}\n${marker}\n`)
}

const siteId = requiredEnv('WEBFLOW_SITE_ID')
const token = requiredEnv('WEBFLOW_API_TOKEN')
const manifest = loadManifest()
if (!Array.isArray(manifest.assets) || !manifest.assets.length) throw new Error('Manifest requires a non-empty assets[] array')

const references = {}
for (const spec of manifest.assets) {
  const key = spec.key || path.parse(spec.fileName || '').name
  if (!key || !/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Invalid asset key: ${key}`)
  console.log(`Downloading ${key} from source...`)
  const downloaded = await downloadAsset(spec)
  console.log(`${key}: ${downloaded.buffer.length} bytes, sha256=${downloaded.sha256}, md5=${downloaded.md5}`)

  const created = await createWebflowAsset(siteId, token, spec, downloaded)
  console.log(`${key}: Webflow asset metadata id=${created.id}`)
  const verified = await verifyWebflowAsset(created.id, token, downloaded.buffer.length)
  console.log(`${key}: verified Webflow asset ${verified.id} (${verified.size} bytes)`)

  references[key] = {
    id: verified.id,
    url: verified.hostedUrl,
    hostedUrl: verified.hostedUrl,
    assetUrl: created.assetUrl || null,
    fileName: spec.fileName,
    contentType: verified.contentType || downloaded.contentType,
    size: Number(verified.size),
    md5: downloaded.md5,
    sha256: downloaded.sha256,
    sourceUrl: spec.sourceUrl,
    resolvedSourceUrl: downloaded.sourceUrl,
  }
}

const result = { siteId, publicationSlug: manifest.publicationSlug || null, assets: references }
const outputPath = process.env.WEBFLOW_ASSET_OUTPUT_PATH || 'webflow-asset-references.json'
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
writeGithubOutput('asset_references', JSON.stringify(result))
writeGithubOutput('asset_references_path', outputPath)
console.log(`Wrote ${outputPath}`)
