import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);

export function isPrivateIp(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b! >= 16 && b! <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (ipVersion === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fe80:')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    return false;
  }
  return false;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith('.localhost')) return true;
  if (h.endsWith('.local')) return true;
  return false;
}

/** Reject SSRF targets (localhost, private IPs, non-http(s)). */
export async function assertUrlAllowed(urlString: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('only http/https URLs are allowed');
  }
  if (url.username || url.password) {
    throw new Error('URL credentials are not allowed');
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error(`blocked host: ${url.hostname}`);
  }

  const hostIp = isIP(url.hostname);
  if (hostIp) {
    if (isPrivateIp(url.hostname)) {
      throw new Error('private IP addresses are not allowed');
    }
    return url;
  }

  const records = await lookup(url.hostname, { all: true });
  if (records.length === 0) {
    throw new Error(`could not resolve host: ${url.hostname}`);
  }
  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error(`private IP not allowed: ${record.address}`);
    }
  }
  return url;
}
