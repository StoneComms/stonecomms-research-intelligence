import crypto from 'node:crypto'

export const SPACING = 48 * 60 * 60 * 1000
export function canonical(value) {
  try {
    const u = new URL(value)
    if (!['https:', 'http:'].includes(u.protocol)) return null
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    return u.hostname + u.pathname.replace(/\/+$/, '')
  } catch { return null }
}
export function urls(text) { return String(text || '').match(/https:\/\/[^\s)\]}>,]+/g) || [] }
export function fingerprint(text) { return String(text || '').replace(/https:\/\/[^\s)\]}>,]+/g, '<url>').replace(/\s+/g, ' ').trim() }
export function matches(request, post) {
  if (fingerprint(request.text) && fingerprint(request.text) === fingerprint(post.text)) return true
  const keys = [request.articleUrl, ...(request.dedupeUrls || [])].map(canonical).filter(Boolean)
  return urls(post.text).some(url => keys.includes(canonical(url)))
}
export async function gql(query, variables = {}) {
  const token = process.env.BUFFER_API_KEY
  if (!token) throw new Error('BUFFER_API_KEY is not configured')
  const r = await fetch('https://api.buffer.com', {method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${token}`}, body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)})
  const data = await r.json()
  if (!r.ok || data.errors?.length) throw new Error(`Buffer request failed: ${JSON.stringify(data.errors || r.status)}`)
  return data.data
}
export async function readBuffer() {
  const account = await gql('query { account { organizations { id } } }')
  const targets = {company:[],personal:[]}
  for (const org of account.account.organizations) {
    const data = await gql('query Channels($organizationId: OrganizationId!) { channels(input:{organizationId:$organizationId}) { id name displayName service } }',{organizationId:org.id})
    for (const c of data.channels) {
      if (String(c.service).toLowerCase() !== 'linkedin') continue
      const names = [c.name,c.displayName].map(x=>String(x || '').toLowerCase().trim())
      const kind = names.includes('lee breheny') ? 'personal' : names.some(x=>['stonecomms','stonecomms research and intelligence','stonecomms research & intelligence'].includes(x)) ? 'company' : null
      if(kind) targets[kind].push({organizationId:org.id,channelId:c.id})
    }
  }
  const result = {}
  for(const kind of ['company','personal']) {
    if(targets[kind].length !== 1) throw new Error(`Expected one ${kind} LinkedIn identity; found ${targets[kind].length}`)
    const {organizationId,channelId} = targets[kind][0]
    const posts = []; let after = null; const seen = new Set()
    do {
      const data = await gql('query Posts($input:PostsInput!,$first:Int,$after:String) { posts(input:$input,first:$first,after:$after) { edges { node { id text status dueAt sentAt externalLink } } pageInfo { endCursor hasNextPage } } }',{input:{organizationId,filter:{channelIds:[channelId]}},first:100,after})
      posts.push(...data.posts.edges.map(x=>x.node))
      if(!data.posts.pageInfo.hasNextPage) break
      after = data.posts.pageInfo.endCursor
      if(!after || seen.has(after)) throw new Error('Invalid Buffer pagination')
      seen.add(after)
    } while(true)
    result[kind] = {posts,channelId}
  }
  return result
}
function decode(s) { return String(s).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>') }
export function pageImages(html) {
  return [...html.matchAll(/<img\b[^>]*>/gi)].map(([tag])=>Object.fromEntries([...tag.matchAll(/([\w-]+)=(["'])(.*?)\2/g)].map(([,k,q,v])=>[k,decode(v)])))
}
export async function approvedHero(articleUrl, expectedAlt, requiredUrl) {
  const article = new URL(articleUrl)
  if(article.protocol !== 'https:' || article.hostname.replace(/^www\./,'') !== 'stonecomms.com' || !article.pathname.startsWith('/research/')) throw new Error('IMAGE BLOCKER: canonical production article required')
  const page = await fetch(articleUrl,{signal:AbortSignal.timeout(30000)})
  if(!page.ok || canonical(page.url) !== canonical(articleUrl)) throw new Error('IMAGE BLOCKER: article is not live at its canonical URL')
  const html = await page.text()
  const images = pageImages(html).filter(i=>i.src && i.alt && (!expectedAlt || i.alt === expectedAlt) && (!requiredUrl || i.src === requiredUrl))
  if(images.length !== 1) throw new Error(`IMAGE BLOCKER: expected one matching published hero; found ${images.length}`)
  const {src:url,alt} = images[0]; const u = new URL(url)
  if(u.protocol !== 'https:' || u.hostname !== 'cdn.prod.website-files.com' || !u.pathname.startsWith('/6a92be796568d7e2b4121557/') || u.search) throw new Error('IMAGE BLOCKER: hero must be a permanent company Webflow asset')
  const image = await fetch(url,{signal:AbortSignal.timeout(30000)})
  const type = image.headers.get('content-type') || ''
  if(!image.ok || !type.startsWith('image/') || image.url !== url) throw new Error('IMAGE BLOCKER: hero URL did not return an image directly')
  const bytes = Buffer.from(await image.arrayBuffer())
  const isPng = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  const isJpeg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255
  const isWebp = bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP'
  if(!isPng && !isJpeg && !isWebp) throw new Error('IMAGE BLOCKER: unsupported or invalid image bytes')
  return {articleUrl,imageUrl:url,alt,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),contentType:type,bytes:bytes.length,checkedAt:new Date().toISOString(),source:'Exact image and alt text on the live production research article'}
}
export async function validateCompanyHero(request) {
  if(!(request.channels || []).map(x=>x.toLowerCase()).includes('linkedin') || !request.articleUrl) return
  if(request.linkAttachment || request.media?.length !== 1 || !request.media[0].alt) throw new Error('IMAGE BLOCKER: research post requires one approved hero, alt text, and no linkAttachment')
  if(!request.scheduledFor || Date.parse(request.scheduledFor) <= Date.now()) throw new Error('Research LinkedIn posts require a future fixed time for 48-hour spacing')
  const evidence = request.heroEvidence
  if(!evidence || canonical(evidence.articleUrl)!==canonical(request.articleUrl) || evidence.imageUrl!==request.media[0].url) throw new Error('IMAGE BLOCKER: missing report-specific approval evidence')
  const fresh = await approvedHero(request.articleUrl,request.media[0].alt,request.media[0].url)
  if(fresh.sha256 !== evidence.sha256) throw new Error('IMAGE BLOCKER: hero bytes changed since validation')
  if(!urls(request.text).some(u=>canonical(u)===canonical(request.articleUrl))) throw new Error('Research URL must be visible in post text')
}
export function londonParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(date).map(x=>[x.type,x.value]))
}
export function londonEleven(date) {
  const p=londonParts(date); let d=new Date(`${p.year}-${p.month}-${p.day}T11:00:00Z`)
  const hour=Number(londonParts(d).hour); d=new Date(+d+(11-hour)*3600000);return d
}
export function nextCompanySlot(now, occupied) {
  let slot=londonEleven(now)
  for(let n=0;n<366;n++) {
    if(+slot>+now+3600000 && occupied.every(t=>Math.abs(+slot-t)>=SPACING))return slot.toISOString()
    slot=londonEleven(new Date(+slot+26*3600000))
  }
  throw new Error('No safely spaced company slot found')
}
export function nextFriday(now) {
  let d=londonEleven(now)
  for(let n=0;n<8;n++) {
    if(londonParts(d).weekday==='Fri' && +d>+now+3600000)return d.toISOString()
    d=londonEleven(new Date(+d+26*3600000))
  }
  throw new Error('No Friday found')
}
