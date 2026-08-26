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

const pdfProjection = `"pdfUrl": coalesce(
  pdfFile.asset->url,
  downloadablePdf.asset->url,
  sourcePdf.asset->url,
  downloadableSourcePdf.asset->url,
  pdfDownload.asset->url,
  pdf.asset->url
)`

export async function getPublications(): Promise<PublicationCard[]> {
  return sanityQuery<PublicationCard[]>(`*[_type == "publication" && defined(slug.current)] | order(publicationDate desc) {
    _id, title, "slug": slug.current, standfirst, publicationDate, publicationType, byline,
    ${pdfProjection}
  }`)
}

export async function getPublication(slug: string): Promise<Publication | null> {
  return sanityQuery<Publication | null>(`*[_type == "publication" && slug.current == $slug][0]{
    _id, title, subtitle, "slug": slug.current, standfirst, publicationDate, publicationType, byline,
    ${pdfProjection},
    keyMetrics, body, methodology, limitations, sourceNote, sources, seo
  }`, { slug })
}
