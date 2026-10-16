// Per-page SEO: <title>, meta description, canonical URL, Open Graph / Twitter tags, robots and JSON-LD.
// Values come from the CMS (each page's SEO fields, falling back to the site defaults in SEO settings).
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSite } from '../context/SiteContext';

function meta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!content) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function link(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!href) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * useSeo({ title, exactTitle, description, image, noindex, jsonLd: object | object[], type })
 * The site suffix from SEO settings is added to `title`; `exactTitle` is used as is.
 */
export function useSeo({ title, exactTitle, description, image, noindex, jsonLd, type = 'website' } = {}) {
  const { site } = useSite();
  const { pathname } = useLocation();
  const ld = JSON.stringify(jsonLd || null);
  useEffect(() => {
    const full = exactTitle || (title ? `${title}${site.seoTitleSuffix || ''}` : site.siteName);
    const desc = description || site.seoDefaultDescription || site.tagline;
    const url = `${window.location.origin}${pathname}`;
    document.title = full;
    meta('name', 'description', desc);
    meta('name', 'robots', noindex || site.searchIndexing === '0' ? 'noindex, nofollow' : 'index, follow');
    meta('property', 'og:title', full);
    meta('property', 'og:description', desc);
    meta('property', 'og:type', type);
    meta('property', 'og:url', url);
    meta('property', 'og:site_name', site.siteName);
    const img = image || site.seoOgImage;
    meta('property', 'og:image', img ? new URL(img, window.location.origin).href : '');
    meta('name', 'twitter:card', img ? 'summary_large_image' : 'summary');
    link('canonical', url);
    document.head.querySelectorAll('script[data-seo]').forEach((s) => s.remove());
    const data = JSON.parse(ld);
    if (data && site.structuredData !== '0') {
      for (const item of [].concat(data)) {
        const s = document.createElement('script');
        s.type = 'application/ld+json';
        s.dataset.seo = '1';
        s.textContent = JSON.stringify({ '@context': 'https://schema.org', ...item });
        document.head.appendChild(s);
      }
    }
  }, [title, exactTitle, description, image, noindex, ld, type, pathname, site]);
}

export const breadcrumbLd = (items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${window.location.origin}${path}` })),
});

export const faqLd = (faqs) => ({
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
});
