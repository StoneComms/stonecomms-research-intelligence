const projectId = 'poc8ca1r'
const dataset = 'production'
const apiVersion = '2026-08-26'

async function sanityQuery<T>(query: string, params: Record<string, string> = {}): Promise<T> {
  const usp = new URLSearchParams({ query })
  for (const [key, value] of Object.entries(params)) usp.set(`$${key}`, JSON.stringify(value))
  const url = `https://${projectId}.api.sanity.io/v${apiVersion}/data/query/${dataset}?${usp.toString()}`
  const res = await fetch(url, { next: { revalidate: 60 } })
  if (!res.ok) throw new Error(`Sanity query failed: ${res.status}`)
  const json = await res.json()
  return json.result as T
}

type SanityFile = string | {asset?: {_ref?: string}}

type PublicationPdfFields = {
  downloadablePdf?: SanityFile
  sourcePdf?: SanityFile
  downloadableSourcePdf?: SanityFile
  pdfDownload?: SanityFile
  pdf?: SanityFile
}

function resolvePdfUrl(publication: PublicationPdfFields): string | undefined {
  const file = publication.downloadablePdf || publication.sourcePdf || publication.downloadableSourcePdf || publication.pdfDownload || publication.pdf
  if (typeof file === 'string') return file
  const match = file?.asset?._ref?.match(/^file-(.+)-([^-]+)$/)
  return match ? `https://cdn.sanity.io/files/${projectId}/${dataset}/${match[1]}.${match[2]}` : undefined
}

function withPdfUrl<T extends PublicationCard>(publication: T & PublicationPdfFields): T {
  return {...publication, pdfUrl: resolvePdfUrl(publication)}
}

export type PublicationCard = {
  _id: string
  title: string
  slug: string
  standfirst?: string
  publicationDate?: string
  publicationType?: string
  byline?: string
  pdfUrl?: string
}

export type Publication = PublicationCard & {
  subtitle?: string
  keyMetrics?: Array<{_key: string; value: string; label: string; referenceNumber?: number}>
  body?: any[]
  methodology?: any[]
  limitations?: any[]
  sourceNote?: string
  sources?: Array<{_key:string; number?:number; citation?:string; url?:string; sourceType?:string}>
  seo?: {title?:string; description?:string; socialTitle?:string; noIndex?:boolean}
}

export async function getPublications(): Promise<PublicationCard[]> {
  return sanityQuery<PublicationCard[]>(`*[_type == "publication" && defined(slug.current)] | order(publicationDate desc) {
    _id, title, "slug": slug.current, standfirst, publicationDate, publicationType, byline,
    downloadablePdf, sourcePdf, downloadableSourcePdf, pdfDownload, pdf
  }`).then(publications => publications.map(withPdfUrl))
}

export async function getPublication(slug: string): Promise<Publication | null> {
  return sanityQuery<Publication | null>(`*[_type == "publication" && slug.current == $slug][0]{
    _id, title, subtitle, "slug": slug.current, standfirst, publicationDate, publicationType, byline,
    downloadablePdf, sourcePdf, downloadableSourcePdf, pdfDownload, pdf,
    keyMetrics, body, methodology, limitations, sourceNote, sources, seo
  }`, { slug }).then(publication => publication ? withPdfUrl(publication) : null)
}
