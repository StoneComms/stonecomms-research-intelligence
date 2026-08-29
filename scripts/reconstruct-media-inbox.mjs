import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {mediaToBuffer} from './media-bridge.mjs'

const INBOX_ROOT = 'media-inbox'
const PUBLIC_ROOT = 'public/media'
const ALLOWED_TYPES = new Set(['image/png', 'application/pdf'])
const ALLOWED_CHECKSUMS = new Set(['sha256', 'sha512', 'sha1', 'md5'])

function fail(message) { throw new Error(message) }

function safeSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) fail(`Invalid publication slug: ${value}`)
  return value
}

function safeOutputName(value) {
  if (typeof value !== 'string' || !value || path.basename(value) !== value || value.includes('..')) fail(`Invalid output filename: ${value}`)
  return value
}

function findManifests(dir = INBOX_ROOT) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findManifests(full))
    else if (entry.isFile() && entry.name === 'manifest.json') out.push(full)
  }
  return out.sort()
}

function validatePartPaths(parts, manifestDir) {
  if (!Array.isArray(parts) || !parts.length) fail('Each media file requires non-empty base64Parts')
  const expectedPrefix = `${manifestDir.replaceAll('\\', '/')}/`
  for (const part of parts) {
    if (typeof part !== 'string') fail('base64Parts entries must be strings')
    const normalized = part.replaceAll('\\', '/')
    if (!normalized.startsWith(`${INBOX_ROOT}/`) || normalized.includes('..')) fail(`Unsafe media chunk path: ${part}`)
    if (!normalized.startsWith(expectedPrefix)) fail(`Chunk is outside its publication directory: ${part}`)
    if (!fs.existsSync(normalized)) fail(`Missing media chunk: ${part}`)
  }
}

function validatePng(bytes) {
  const signature = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]
  if (bytes.length < 8 || signature.some((v,i) => bytes[i] !== v)) fail('PNG signature validation failed')
}

function validatePdf(bytes) {
  if (bytes.length < 16 || bytes.subarray(0,5).toString('ascii') !== '%PDF-') fail('PDF signature validation failed')
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096)).toString('latin1')
  if (!tail.includes('%%EOF')) fail('PDF completeness validation failed: %%EOF marker not found near end of file')
}

function digest(bytes, algorithm) {
  if (!ALLOWED_CHECKSUMS.has(algorithm)) fail(`Unsupported checksum algorithm: ${algorithm}`)
  return crypto.createHash(algorithm).update(bytes).digest('hex')
}

function verifyChecksums(bytes, spec, label) {
  const checks = []
  for (const algorithm of ALLOWED_CHECKSUMS) if (typeof spec[algorithm] === 'string' && spec[algorithm]) checks.push([algorithm, spec[algorithm]])
  if (spec.checksum) {
    const algorithm = String(spec.checksum.algorithm || '').toLowerCase()
    const value = String(spec.checksum.value || '')
    if (!algorithm || !value) fail(`${label}: checksum requires algorithm and value`)
    checks.push([algorithm, value])
  }
  for (const [algorithm, expectedRaw] of checks) {
    const expected = expectedRaw.toLowerCase()
    const actual = digest(bytes, algorithm)
    if (actual !== expected) fail(`${label}: ${algorithm} mismatch; expected ${expected}, got ${actual}`)
  }
}

async function reconstructManifest(manifestPath) {
  const manifestDir = path.dirname(manifestPath).replaceAll('\\', '/')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const slug = safeSlug(manifest.publicationSlug || manifest.slug)
  if (manifestDir !== `${INBOX_ROOT}/${slug}`) fail(`${manifestPath}: directory must match publication slug ${slug}`)
  if (!Array.isArray(manifest.files) || !manifest.files.length) fail(`${manifestPath}: files[] is required`)

  for (const spec of manifest.files) {
    const output = safeOutputName(spec.output || spec.filename)
    const contentType = spec.contentType
    if (!ALLOWED_TYPES.has(contentType)) fail(`${output}: unsupported content type ${contentType}`)
    validatePartPaths(spec.base64Parts, manifestDir)
    const {bytes} = await mediaToBuffer({base64Parts: spec.base64Parts, contentType, filename: output})
    if (!bytes.length) fail(`${output}: reconstructed output is zero bytes`)
    if (contentType === 'image/png') validatePng(bytes)
    if (contentType === 'application/pdf') validatePdf(bytes)
    if (spec.expectedBytes !== undefined) {
      if (!Number.isInteger(spec.expectedBytes) || spec.expectedBytes < 1) fail(`${output}: expectedBytes must be a positive integer`)
      if (bytes.length !== spec.expectedBytes) fail(`${output}: byte-size mismatch; expected ${spec.expectedBytes}, got ${bytes.length}`)
    }
    verifyChecksums(bytes, spec, output)
    const destinationDir = path.join(PUBLIC_ROOT, slug)
    const destination = path.join(destinationDir, output)
    fs.mkdirSync(destinationDir, {recursive: true})
    if (fs.existsSync(destination) && fs.readFileSync(destination).equals(bytes)) {
      console.log(`Verified unchanged ${destination} (${bytes.length} bytes)`)
      continue
    }
    fs.writeFileSync(destination, bytes)
    if (!fs.readFileSync(destination).equals(bytes)) fail(`${destination}: post-write verification failed`)
    console.log(`Reconstructed ${destination} (${bytes.length} bytes)`)
  }
}

const manifests = process.argv.slice(2).length ? process.argv.slice(2) : findManifests()
if (!manifests.length) fail(`No manifest.json files found beneath ${INBOX_ROOT}/`)
for (const manifestPath of manifests) await reconstructManifest(manifestPath)
