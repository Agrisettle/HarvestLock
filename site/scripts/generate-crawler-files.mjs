import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const rawSiteUrl = process.env.SITE_URL

if (!rawSiteUrl) {
  console.warn(
    'SITE_URL is unset; sitemap.xml and robots.txt generation is disabled. ' +
      'Set SITE_URL to the canonical production origin to emit crawler files.',
  )
  process.exit(0)
}

let siteUrl
try {
  siteUrl = new URL(rawSiteUrl)
} catch {
  throw new Error('SITE_URL must be a valid HTTPS origin, for example https://example.com')
}

if (
  siteUrl.protocol !== 'https:' ||
  siteUrl.username ||
  siteUrl.password ||
  siteUrl.pathname !== '/' ||
  siteUrl.search ||
  siteUrl.hash
) {
  throw new Error('SITE_URL must be a canonical HTTPS origin without credentials, path, query, or fragment')
}

const origin = siteUrl.origin
const pages = ['/', '/roles.html']
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...pages.map((page) => `  <url><loc>${origin}${page}</loc></url>`),
  '</urlset>',
  '',
].join('\n')

const robots = [
  'User-agent: *',
  'Allow: /',
  `Sitemap: ${origin}/sitemap.xml`,
  '',
].join('\n')

await mkdir('dist', { recursive: true })
await Promise.all([
  writeFile(resolve('dist/sitemap.xml'), sitemap),
  writeFile(resolve('dist/robots.txt'), robots),
])

console.log(`Generated sitemap.xml and robots.txt for ${origin}`)
