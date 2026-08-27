import fs from 'node:fs'

const projectId = 'poc8ca1r'
const dataset = 'production'
const apiVersion = '2026-08-27'

function assertSafeRepoPath(p) {
  if (typeof p !== 'string' || !p.startsWith('media-inbox/') || p.includes('..')) {
    throw new Error(`Unsafe media inbox path: ${p}`)
  }
  return p
}

export async function mediaToBuffer(media) {
  if (Array.isArray(media?.base64Parts) && media.base64Parts.length) {
    const joined = media.base64Parts
      .map(assertSafeRepoPath)
      .map(p => fs.readFileSync(p, 'utf8').trim())
      .join('')
    const bytes = Buffer.from(joined, 'base64')
    if (!bytes.length) throw new Error('base64Parts decoded to an empty file')
    return {
      bytes,
      contentType: media.contentType || 'image/jpeg',
      filename: media.filename || 'stonecomms-image.jpg',
    }
  }

  if (media?.dataBase64) {
    const bytes = Buffer.from(media.dataBase64, 'base64')
    return {
      bytes,
      contentType: media.contentType || 'image/jpeg',
      filename: media.filename || 'stonecomms-image.jpg',
    }
  }

  if (media?.url) {
    const response = await fetch(media.url)
    if (!response.ok) throw new Error(`Could not fetch media: ${response.status}`)
    const contentType = response.headers.get('content-type') || media.contentType || 'image/jpeg'
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType,
      filename: media.filename || 'stonecomms-image.jpg',
    }
  }

  throw new Error('Media requires base64Parts, dataBase64, or url')
}

function validateImageSignature(bytes, contentType) {
  if (contentType === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      throw new Error('JPEG signature/end marker validation failed')
    }
  }
  if (contentType === 'image/png') {
    const sig = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]
    if (bytes.length < 8 || sig.some((v,i) => bytes[i] !== v)) throw new Error('PNG signature validation failed')
  }
}

export async function uploadImageToSanity(media, token = process.env.SANITY_WRITE_TOKEN) {
  if (!token) throw new Error('SANITY_WRITE_TOKEN is not configured')

  const {bytes, contentType, filename} = await mediaToBuffer(media)
  if (!contentType.startsWith('image/')) throw new Error(`Media is not an image (${contentType})`)
  if (bytes.length < 1024) throw new Error(`Media file is unexpectedly small (${bytes.length} bytes)`)
  validateImageSignature(bytes, contentType)

  const response = await fetch(
    `https://${projectId}.api.sanity.io/v${apiVersion}/assets/images/${dataset}?filename=${encodeURIComponent(filename)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': contentType,
      },
      body: bytes,
    },
  )

  if (!response.ok) throw new Error(`Sanity image upload failed: ${response.status} ${await response.text()}`)
  const payload = await response.json()
  const asset = payload.document
  if (!asset?._id || !asset?.url) throw new Error('Sanity image upload returned no asset id/url')

  return {
    assetId: asset._id,
    url: asset.url,
    metadata: asset.metadata,
  }
}
