import test from 'node:test'
import assert from 'node:assert/strict'
import {canonical,matches,nextCompanySlot,nextFriday,SPACING,validateCompanyHero,approvedHero} from '../scripts/social-safety.mjs'

test('Research duplicate survives tracking, www and LinkedIn shortening',()=>{
  assert.equal(canonical('https://www.stonecomms.com/research/a/?utm_source=linkedin'),'stonecomms.com/research/a')
  assert.ok(matches({articleUrl:'https://stonecomms.com/research/a',text:'A report https://stonecomms.com/research/a?utm_source=linkedin'}, {text:'A report https://lnkd.in/test'}))
  assert.ok(matches({articleUrl:'https://stonecomms.com/research/a',text:'Other'}, {text:'Details https://www.stonecomms.com/research/a/?utm_source=test'}))
  assert.ok(!matches({articleUrl:'https://stonecomms.com/research/a',text:'A report'}, {text:'Different report'}))
})
test('Company spacing across UK clock change stays at least 48 real hours',()=>{
  const now=new Date('2026-10-22T21:00:00Z'),occupied=[]
  const dates=[]
  for(let i=0;i<6;i++){const d=nextCompanySlot(now,occupied);dates.push(d);occupied.push(Date.parse(d))}
  assert.equal(dates[0],'2026-10-23T10:00:00.000Z')
  assert.equal(dates[1],'2026-10-25T11:00:00.000Z')
  for(let i=1;i<dates.length;i++)assert.ok(Date.parse(dates[i])-Date.parse(dates[i-1])>=SPACING)
  assert.equal(nextFriday(now),'2026-10-23T10:00:00.000Z')
  assert.equal(nextFriday(new Date('2026-10-25T12:00:00Z')),'2026-10-30T11:00:00.000Z')
})
test('Spring clock change cannot create a 47-hour company gap',()=>{
  const now=new Date('2027-03-25T19:00:00Z'),occupied=[Date.parse('2027-03-26T11:00:00Z')]
  const next=nextCompanySlot(now,occupied)
  assert.ok(Date.parse(next)>occupied[0])
  assert.ok(Date.parse(next)-occupied[0]>=SPACING)
})
test('Missing or substituted images fail before publication',async()=>{
  await assert.rejects(validateCompanyHero({channels:['linkedin'],articleUrl:'https://stonecomms.com/research/a'}),/IMAGE BLOCKER/)
  const original=global.fetch
  global.fetch=async()=>({ok:true,url:'https://stonecomms.com/research/a',text:async()=>'<img src="https://cdn.prod.website-files.com/6a92be796568d7e2b4121557/exact.png" alt="Exact report">'})
  try {await assert.rejects(approvedHero('https://stonecomms.com/research/a','Exact report','https://cdn.prod.website-files.com/6a92be796568d7e2b4121557/substitute.png'),/IMAGE BLOCKER/)}finally{global.fetch=original}
})
test('HTML masquerading as an image is blocked',async()=>{
  const original=global.fetch
  global.fetch=async url=>url.includes('stonecomms.com/research')?{ok:true,url,text:async()=>'<img src="https://cdn.prod.website-files.com/6a92be796568d7e2b4121557/a.png" alt="A">'}:{ok:true,url,headers:new Headers({'content-type':'image/png'}),arrayBuffer:async()=>new TextEncoder().encode('<html>failure</html>').buffer}
  try{await assert.rejects(approvedHero('https://stonecomms.com/research/a','A'),/invalid image bytes/)}finally{global.fetch=original}
})
