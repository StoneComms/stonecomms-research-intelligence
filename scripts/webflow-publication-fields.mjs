const PUBLIC_SITE_ORIGIN = 'https://stonecomms.com'
const RESEARCH_COLLECTION_ID = '6a92be796568d7e2b412157f'

export function preparePublicationFields(manifest) {
  const isResearchPublication = manifest.collectionId === RESEARCH_COLLECTION_ID
  const canonicalUrl = isResearchPublication
    ? `${PUBLIC_SITE_ORIGIN}/research/${encodeURIComponent(manifest.fieldData.slug)}`
    : manifest.liveUrl
  const fieldData = isResearchPublication
    ? { ...manifest.fieldData, 'article-url': canonicalUrl }
    : { ...manifest.fieldData }
  return { isResearchPublication, canonicalUrl, fieldData }
}
