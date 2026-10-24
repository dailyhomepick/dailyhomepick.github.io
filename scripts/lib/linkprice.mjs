// LinkPrice deep links. The affiliate id (A-code) appears in every click URL, so it is not a secret;
// it still lives in env (LINKPRICE_AFFILIATE_ID) so the repo works for whoever runs it.
// Merchant ids per shop host are kept in data/merchants.json.

import { readFileSync } from 'node:fs';

export function loadMerchants(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { template: '', merchants: [] }; }
}

export function merchantFor(url, merchants) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch { return null; }
  return merchants.merchants.find((m) => m.enabled !== false && m.id && m.hosts.some((h) => host === h || host.endsWith(`.${h}`))) || null;
}

// Returns a tracking URL, or '' when the shop is not an approved LinkPrice merchant.
export function deeplinkFor(url, merchants, subId = '') {
  const affiliateId = process.env.LINKPRICE_AFFILIATE_ID;
  const m = merchantFor(url, merchants);
  if (!affiliateId || !m || !merchants.template) return '';
  return merchants.template
    .replace('{merchant}', encodeURIComponent(m.id))
    .replace('{affiliateId}', encodeURIComponent(affiliateId))
    .replace('{subId}', encodeURIComponent(subId))
    .replace('{url}', encodeURIComponent(url));
}
