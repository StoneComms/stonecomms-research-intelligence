const projectId = 'poc8ca1r'
const dataset = 'production'
const apiVersion = '2026-08-27'

export async function mediaToBuffer(media) {
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

  throw new Error('Media requires either dataBase64 or url')
}

export async function uploadImageToSanity(media, token = process.env.SANITY_WRITE_TOKEN) {
  if (!token) throw new Error('SANITY_WRITE_TOKEN is not configured')

  const {bytes, contentType, filename} = await mediaToBuffer(media)
  if (!contentType.startsWith('image/')) throw new Error(`Media is not an image (${contentType})`)

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
