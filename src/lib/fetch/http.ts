import { assertUrlAllowed } from './ssrf.js';

export const FETCH_TIMEOUT_MS = 30_000;
export const FETCH_BODY_CAP_BYTES = 5 * 1024 * 1024;
export const FETCH_MAX_REDIRECTS = 5;
export const FETCH_USER_AGENT = 'TokenDiet-MCP/0.2';

export interface FetchResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

async function readBodyText(res: Response): Promise<string> {
  const len = res.headers.get('content-length');
  if (len && Number(len) > FETCH_BODY_CAP_BYTES) {
    throw new Error(`response body exceeds ${FETCH_BODY_CAP_BYTES} bytes`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > FETCH_BODY_CAP_BYTES) {
    throw new Error(`response body exceeds ${FETCH_BODY_CAP_BYTES} bytes`);
  }
  return buf.toString('utf8');
}

/** Fetch URL with SSRF checks, redirect cap, timeout, and body size limit. */
export async function safeFetch(urlString: string): Promise<FetchResponse> {
  let current = urlString;

  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
    await assertUrlAllowed(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': FETCH_USER_AGENT,
          Accept: 'text/html,application/json,text/plain,*/*',
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('fetch timed out after 30s');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`redirect ${res.status} without Location header`);
      }
      if (hop >= FETCH_MAX_REDIRECTS) {
        throw new Error('too many redirects');
      }
      current = new URL(location, current).href;
      continue;
    }

    const body = await readBodyText(res);
    return {
      url: current,
      status: res.status,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      body,
    };
  }

  throw new Error('too many redirects');
}
