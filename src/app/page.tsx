import Link from 'next/link'
import {getPublications} from '@/lib/sanity'

export default async function Home(){
  const pubs=await getPublications(); const latest=pubs[0]
  return <main>
    <section className="hero"><div className="wrap"><div className="eyebrow">Stone Research Intelligence</div><h1>Evidence, clearly seen.</h1><p>Independent research and intelligence for Africa’s climate economy — designed for decision-makers working across policy, capital and implementation.</p><Link href="/research" className="button">Explore the research</Link></div></section>
    <section className="section"><div className="wrap"><div className="eyebrow">Latest research</div><h2>Research built to be used</h2>{latest && <div className="research-grid"><article className="card"><div className="eyebrow">Flagship research</div><h3><Link href={`/research/${latest.slug}`}>{latest.title}</Link></h3><p>{latest.standfirst}</p><div className="meta">{latest.publicationDate} · {latest.byline || 'StoneComms Research & Intelligence'}</div></article></div>}</div></section>
  </main>
}
