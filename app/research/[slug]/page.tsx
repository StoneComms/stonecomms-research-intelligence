import type {Metadata} from 'next'
import Link from 'next/link'
import {notFound} from 'next/navigation'
import {PortableText, type PortableTextComponents} from '@portabletext/react'
import {getPublication} from '@/lib/sanity'
import PdfDownloadLink from '../PdfDownloadLink'

const components:PortableTextComponents={
  block:{h2:({children})=><h2>{children}</h2>,h3:({children})=><h3>{children}</h3>,normal:({children})=><p>{children}</p>,blockquote:({children})=><blockquote>{children}</blockquote>},
  marks:{strong:({children})=><strong>{children}</strong>,em:({children})=><em>{children}</em>,link:({children,value})=><a href={value?.href} rel="noreferrer noopener">{children}</a>},
  types:{
    dataTable:({value})=><div className="data-table-wrap"><table className="data-table"><thead><tr>{value.columns?.map((c:string,i:number)=><th key={i}>{c}</th>)}</tr></thead><tbody>{value.rows?.map((r:any)=><tr key={r._key}>{r.cells?.map((c:string,i:number)=><td key={i}>{c}</td>)}</tr>)}</tbody></table>{value.caption&&<p className="figure-caption">{value.caption}</p>}</div>,
    image:({value})=>value.url?<figure className="body-figure"><img src={value.url} alt={value.alt||''} width={value.dimensions?.width} height={value.dimensions?.height}/>{(value.caption||value.credit)&&<figcaption>{value.caption}{value.caption&&value.credit?' · ':''}{value.credit}</figcaption>}</figure>:null
  }
}

type Props={params:Promise<{slug:string}>}

export async function generateMetadata({params}:Props):Promise<Metadata>{
  const {slug}=await params
  const p=await getPublication(slug)
  if(!p)return {}
  const socialImage=p.seo?.socialImage?.url||p.heroImage?.url
  return {
    title:p.seo?.title||p.title,
    description:p.seo?.description||p.standfirst,
    robots:p.seo?.noIndex?'noindex':undefined,
    openGraph:{
      title:p.seo?.socialTitle||p.title,
      description:p.seo?.description||p.standfirst,
      type:'article',
      publishedTime:p.publicationDate,
      images:socialImage?[{url:socialImage,alt:p.seo?.socialImage?.alt||p.heroImage?.alt||p.title}]:undefined
    }
  }
}

export default async function PublicationPage({params}:Props){
  const {slug}=await params
  const p=await getPublication(slug)
  if(!p)notFound()
  const hasSources=Boolean(p.sources?.length||p.sourceNote)

  return <main className="article-shell"><article className="article">
    <div className="article-header"><div className="eyebrow">{p.publicationType?.replaceAll('-',' ')||'Flagship research'} · {p.publicationDate}</div><h1>{p.title}</h1>{p.subtitle&&<div className="subtitle">{p.subtitle}</div>}<p className="standfirst">{p.standfirst}</p><PdfDownloadLink url={p.pdfUrl}/><div className="meta-row"><span>{p.byline||'StoneComms Research & Intelligence'}</span><span><Link href="/research">← Back to research</Link></span></div>{p.keyMetrics?.length?<div className="metrics">{p.keyMetrics.map(m=><div className="metric" key={m._key}><strong>{m.value}</strong><span>{m.label}{m.referenceNumber?` [${m.referenceNumber}]`:''}</span></div>)}</div>:null}</div>
    {p.heroImage?.url?<figure className="article-hero"><img src={p.heroImage.url} alt={p.heroImage.alt||p.title} width={p.heroImage.dimensions?.width} height={p.heroImage.dimensions?.height}/>{(p.heroImage.caption||p.heroImage.credit)&&<figcaption>{p.heroImage.caption}{p.heroImage.caption&&p.heroImage.credit?' · ':''}{p.heroImage.credit}</figcaption>}</figure>:null}
    <div className={`article-content${p.heroImage?.url?' article-content-after-hero':''}`}><PortableText value={p.body||[]} components={components}/></div>
    {p.methodology?.length?<section className="panel"><div className="eyebrow">Evidence & method</div><PortableText value={p.methodology} components={components}/></section>:null}
    {p.limitations?.length?<section className="panel"><div className="eyebrow">Limitations & uncertainty</div><PortableText value={p.limitations} components={components}/></section>:null}
    {hasSources?<section className="panel sources"><div className="eyebrow">References</div><h2>Sources and data notes</h2>{p.sources?.length?<ol>{p.sources.map(s=><li key={s._key}>{s.citation} {s.url&&<a href={s.url}>Source ↗</a>}</li>)}</ol>:null}{p.sourceNote&&<p><strong>Source note:</strong> {p.sourceNote}</p>}</section>:null}
  </article></main>
}
