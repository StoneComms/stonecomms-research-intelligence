import fs from 'node:fs'
import path from 'node:path'
import {canonical,matches,urls,readBuffer,approvedHero,nextCompanySlot,nextFriday} from './social-safety.mjs'
const kind=process.argv[2]
if(!['company','personal'].includes(kind))throw new Error('Specify company or personal')
const now=new Date()
function requests(dir) {return fs.readdirSync(dir).filter(x=>x.endsWith('.json')).map(file=>({file,...JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'))}))}
const company=requests('social-outbox'), personal=requests('personal-social-outbox')
const manifests=fs.readdirSync('webflow-publications').filter(x=>x.endsWith('.json')).map(file=>({file,...JSON.parse(fs.readFileSync(path.join('webflow-publications',file),'utf8'))})).filter(x=>x.collectionId==='6a92be796568d7e2b412157f' && x.fieldData?.slug && Date.parse(x.fieldData['publication-date'])<=+now).sort((a,b)=>a.fieldData['publication-date'].localeCompare(b.fieldData['publication-date']) || a.file.localeCompare(b.file))
const state=await readBuffer()
const report={checkedAt:now.toISOString(),kind,created:[],blockers:[]}
function article(m) {return `https://stonecomms.com/research/${m.fieldData.slug}`}
function write(dir,file,data) {const p=path.join(dir,file);if(fs.existsSync(p))throw new Error(`Refusing overwrite ${p}`);fs.writeFileSync(p,JSON.stringify(data,null,2)+'\n');report.created.push(p)}
function tracked(url,date,content) {const u=new URL(url);u.search=new URLSearchParams({utm_source:'linkedin',utm_medium:'organic_social',utm_campaign:u.pathname.split('/').pop(),utm_content:`${date}-${content}`}).toString();return u.href}
if(kind==='company') {
  const occupied=state.company.posts.filter(p=>['sent','sending','scheduled'].includes(p.status)).flatMap(p=>[p.sentAt,p.dueAt]).map(Date.parse).filter(Number.isFinite)
  occupied.push(...company.filter(r=>r.status==='ready').map(r=>Date.parse(r.scheduledFor)).filter(Number.isFinite))
  for(const m of manifests) {
    const url=article(m),f=m.fieldData
    // Any historical receipt reserves this article. Failed or ambiguous live posts also block recreation.
    if(company.some(r=>canonical(r.articleUrl)===canonical(url)) || state.company.posts.some(p=>matches({articleUrl:url,text:`${f.name}\n\n${f.standfirst}`},p)))continue
    try {
      const hero=await approvedHero(url,f['hero-alt-text'])
      const scheduledFor=nextCompanySlot(now,occupied),date=scheduledFor.slice(0,10)
      const text=`${f.name}\n\n${f.standfirst}\n\nRead the full StoneComms research:\n${tracked(url,date,'main-post')}\n\n#AfricanInfrastructure #DevelopmentFinance #StoneComms`
      if(text.length>3000)throw new Error('Post exceeds LinkedIn limit')
      write('social-outbox',`${date}-${f.slug}-linkedin.json`,{status:'ready',channels:['linkedin'],articleUrl:url,scheduledFor,text,media:[{type:'image',url:hero.imageUrl,alt:hero.alt}],heroEvidence:hero,sourceManifest:`webflow-publications/${m.file}`,handoff:'Automatically prepared from published report title, standfirst and exact live hero; authorized cadence restoration 22 October 2026'})
      occupied.push(Date.parse(scheduledFor))
    } catch(e) {report.blockers.push({articleUrl:url,message:e.message});console.error(`${url}: ${e.message}`)}
  }
} else {
  const scheduledFor=nextFriday(now),date=scheduledFor.slice(0,10)
  const file=`${date}-lee-weekly-research-roundup.json`
  if(!fs.existsSync(`personal-social-outbox/${file}`)) {
    const coverage=JSON.parse(fs.readFileSync('social-reconciliation/personal-coverage.json','utf8'))
    const knownIds=new Set([...personal.flatMap(r=>[r.result?.postId,...(r.results || []).map(x=>x.postId)]),...coverage.map(x=>x.postId),'6acce69c1b080f2a6066d067'])
    const unreviewed=state.personal.posts.filter(p=>p.status==='sent' && Date.parse(p.sentAt)>=Date.parse('2026-10-08T00:00:00Z') && /stonecomms/i.test(p.text) && !knownIds.has(p.id))
    if(unreviewed.length) throw new Error(`Personal reconciliation required for unrecorded StoneComms posts: ${unreviewed.map(p=>p.externalLink || p.id).join(', ')}`)
    const covered=new Set([...personal.flatMap(r=>r.dedupeUrls || []),...coverage.map(x=>x.articleUrl)].map(canonical))
    for(const p of state.personal.posts) for(const u of urls(p.text)) covered.add(canonical(u))
    const eligible=[]
    for(const m of manifests) {
      const url=article(m)
      if(covered.has(canonical(url)))continue
      const receipt=company.find(r=>canonical(r.articleUrl)===canonical(url))
      const ids=(receipt?.results || []).map(x=>x.postId)
      const post=state.company.posts.find(p=>p.status==='sent' && p.sentAt && p.externalLink && (ids.includes(p.id)||matches({articleUrl:url,text:''},p)))
      if(post)eligible.push({m,url,post})
    }
    // Carry previously missed, unrounded company publications forward; never replay an old roundup.
    const chosen=eligible.slice(0,3)
    if(chosen.length) {
      function render() { return `A research catch-up from my team at StoneComms.\n\n${chosen.map(({m,url})=>`${m.fieldData.name}\n${m.fieldData.standfirst}\n${tracked(url,date,'personal-roundup')}`).join('\n\n')}\n\nThe full papers are freely available. If your organisation needs research on a specific African infrastructure, energy or investment question, I would welcome a conversation.\n\n#AfricanInfrastructure #DevelopmentFinance` }
      while(chosen.length>1 && render().length>3000)chosen.pop()
      const text=render()
      if(text.length>3000)throw new Error('Roundup exceeds LinkedIn limit; shorten source summaries before publication')
      write('personal-social-outbox',file,{status:'ready',scheduledFor,timezone:'Europe/London',dedupeUrls:chosen.map(x=>x.url),text,publicationEvidence:chosen.map(x=>({articleUrl:x.url,postId:x.post.id,sentAt:x.post.sentAt,externalLink:x.post.externalLink})),scopeNote:'Only company research with verified sent timestamps and LinkedIn URLs; unrounded backlog carried forward; excludes prior roundup URLs and reconciled manual personal coverage.'})
    }
  }
}
fs.writeFileSync(`social-${kind}-handoff-result.json`,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
