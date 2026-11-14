// Decode invite data only. Never navigate to a scanned URL or send it elsewhere.
export function podInviteFromQr(value, origin = globalThis.location?.origin) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const raw=value.trim();
  const valid=token=>token.length<=240 && /^pod\.pod_[A-Za-z0-9_-]{1,96}\.[A-Za-z0-9_-]{1,100}$/.test(token);
  if (valid(raw)) return raw;
  if (/[\u0000-\u0020\u007f]/.test(raw)) return null;
  try {
    const url=new URL(raw);
    if (!['https:','http:'].includes(url.protocol) || url.origin!==origin || url.username || url.password
      || !['/','/index.html'].includes(url.pathname) || url.search) return null;
    const params=new URLSearchParams(url.hash.slice(1));
    const entries=[...params];
    return entries.length===1 && entries[0][0]==='invite' && valid(entries[0][1]) ? entries[0][1] : null;
  } catch { return null; }
}
