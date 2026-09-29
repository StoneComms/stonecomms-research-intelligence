import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { preparePublicationFields } from '../scripts/webflow-publication-fields.mjs'

function manifest(path) {
  return JSON.parse(readFileSync(new URL(`../webflow-publications/${path}`, import.meta.url), 'utf8'))
}

test('research manifest gets its canonical article URL', () => {
  const input = manifest('ai-compute-african-mini-grids-flexible-demand-electricity-access.json')
  const { isResearchPublication, canonicalUrl, fieldData } = preparePublicationFields(input)
  assert.equal(isResearchPublication, true)
  assert.equal(canonicalUrl, `https://stonecomms.com/research/${input.fieldData.slug}`)
  assert.equal(fieldData['article-url'], canonicalUrl)
  assert.deepEqual(fieldData, { ...input.fieldData, 'article-url': canonicalUrl })
})

test('SDG taxonomy update leaves fields untouched', () => {
  for (const path of [
    'sdg-7-affordable-and-clean-energy-2026-09-28-ai-compute-index.json',
    'sdg-9-industry-innovation-and-infrastructure-2026-09-28-ai-compute-index.json',
  ]) {
    const input = manifest(path)
    const { isResearchPublication, canonicalUrl, fieldData } = preparePublicationFields(input)
    assert.equal(isResearchPublication, false)
    assert.equal(canonicalUrl, input.liveUrl)
    assert.equal(Object.hasOwn(fieldData, 'article-url'), false)
    assert.deepEqual(fieldData, input.fieldData)
  }
})
