import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
const number = (ip) => ip.split('.').reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0);
const privateIp = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

export function phoneNetworks(interfaces = networkInterfaces()) {
  const found = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses || [])
      .filter((nic) => nic.family === 'IPv4' && !nic.internal && privateIp(nic.address))
      .map((nic) => ({ name, address: nic.address, netmask: nic.netmask }))
  );
  const virtual = (nic) => (/virtual|wsl|vpn|hyper-v|docker|vethernet|loopback/i.test(nic.name) ? 1 : 0);
  return found.sort((a, b) => virtual(a) - virtual(b) || a.name.localeCompare(b.name));
}

// The authenticated desktop process always stays on loopback. This separate,
// short-lived listener serves only the game shell and its single preview token.
export async function startStudioPhoneShare({ origin, ticket, expiresAt, networkAddress }) {
  const networks = phoneNetworks();
  const candidate = networkAddress ? networks.find((nic) => nic.address === networkAddress) : networks[0];
  if (!candidate)
    throw Object.assign(new Error('Connect this computer to a private Wi-Fi or Ethernet network first.'), {
      status: 409,
    });
  const shell = await readFile(new URL('../client/sw.js', import.meta.url), 'utf8');
  const list = shell.match(/const APP_SHELL\s*=\s*\[([^\]]+)\]/)?.[1] || '';
  const allowed = new Set(Array.from(list.matchAll(/'\.\/([^']+)'/g), (m) => '/' + m[1].split('?')[0]));
  const sessionPath = '/api/studio-playtests/' + ticket;
  const statusPath = sessionPath + '/status';
  let stopped = false;
  let shareOrigin;
  const listener = createServer(async (req, res) => {
    try {
      const peer = req.socket.remoteAddress || '';
      if (
        !privateIp(peer) ||
        (number(peer) & number(candidate.netmask)) !==
          (number(candidate.address) & number(candidate.netmask)) ||
        'http://' + req.headers.host !== shareOrigin ||
        (req.headers.origin && req.headers.origin !== shareOrigin)
      ) {
        res.writeHead(403).end();
        return;
      }
      if (req.method !== 'GET' || Date.now() >= expiresAt) {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url, shareOrigin);
      if (stopped) {
        res.writeHead(url.pathname === statusPath ? 410 : 404, { 'cache-control': 'no-store' }).end();
        return;
      }
      if (url.pathname === '/api/game-layout') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"layout":null}');
        return;
      }
      if (url.pathname === '/api/game-skins') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"skins":[]}');
        return;
      }
      if (
        url.pathname === '/index.html' &&
        (url.searchParams.get('practice-release') !== ticket ||
          url.searchParams.get('appearance-preview') !== '1')
      ) {
        res.writeHead(404).end();
        return;
      }
      if (url.pathname !== sessionPath && url.pathname !== statusPath && !allowed.has(url.pathname)) {
        res.writeHead(404).end();
        return;
      }
      const upstream = await fetch(new URL(url.pathname + url.search, origin), {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "connect-src 'self'; frame-ancestors 'none'; form-action 'none'",
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  await new Promise((yes, no) => {
    listener.once('error', no);
    listener.listen(0, candidate.address, yes);
  });
  shareOrigin = 'http://' + candidate.address + ':' + listener.address().port;
  const timer = setTimeout(close, Math.max(1, expiresAt - Date.now()));
  timer.unref();
  function close() {
    stopped = true;
    listener.close();
    listener.closeAllConnections();
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    // Connected phones can receive an explicit revocation on their next check.
    // Nothing else is served during this short grace period.
    setTimeout(close, 30000).unref();
  }
  return { origin: shareOrigin, stop };
}
