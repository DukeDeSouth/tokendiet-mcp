import { describe, it, expect } from 'vitest';
import { isPrivateIp, assertUrlAllowed } from '../src/lib/fetch/ssrf.js';
import { contentTypeForFetch, isBinaryContentType } from '../src/lib/fetch/contentType.js';
import { transformHtml } from '../src/pipeline/transforms/html.js';
import { verifyHtml } from '../src/pipeline/verifyHtml.js';

describe('isPrivateIp', () => {
  it('detects private IPv4 ranges', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('192.168.0.1')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });
});

describe('assertUrlAllowed', () => {
  it('blocks localhost', async () => {
    await expect(assertUrlAllowed('http://localhost/path')).rejects.toThrow(/blocked host/i);
    await expect(assertUrlAllowed('http://127.0.0.1/')).rejects.toThrow(/private IP/i);
  });

  it('blocks non-http schemes', async () => {
    await expect(assertUrlAllowed('file:///etc/passwd')).rejects.toThrow(/only http/i);
  });
});

describe('transformHtml', () => {
  it('strips nav/script and preserves main content', () => {
    const html = `<!DOCTYPE html><html><body>
      <nav><a href="/skip">Skip</a></nav>
      <script>alert(1)</script>
      <h1>Title</h1>
      <p>Intro paragraph.</p>
      <pre><code>const x = 1;</code></pre>
      <a href="https://example.com/docs">Docs</a>
    </body></html>`;
    const { output, htmlMeta } = transformHtml(html);
    expect(output).toContain('# Title');
    expect(output).toContain('Intro paragraph.');
    expect(output).toContain('const x = 1;');
    expect(output).toContain('Docs (https://example.com/docs)');
    expect(output).not.toContain('alert');
    expect(output).not.toContain('/skip');
    expect(htmlMeta.contentUrls).toContain('https://example.com/docs');
    expect(htmlMeta.preCodeBlocks.some((b) => b.includes('const x = 1'))).toBe(true);
  });
});

describe('verifyHtml', () => {
  it('passes when pre/code and content URLs are preserved', () => {
    const original = '<html><body><pre>code block</pre><a href="https://ex.com">x</a></body></html>';
    const { output, htmlMeta } = transformHtml(original);
    const verdict = verifyHtml(original, output, htmlMeta);
    expect(verdict.pass).toBe(true);
  });

  it('fails when pre/code block is lost', () => {
    const meta = { contentUrls: [], preCodeBlocks: ['secret code'] };
    const verdict = verifyHtml('<pre>secret code</pre>', 'no code here', meta);
    expect(verdict.failures.some((f) => f.rule === 'pre-code-preserved')).toBe(true);
  });
});

describe('contentTypeForFetch', () => {
  it('classifies json and html', () => {
    expect(contentTypeForFetch('application/json', '{"a":1}')).toBe('json');
    expect(contentTypeForFetch('text/html; charset=utf-8', '<html></html>')).toBe('html');
    expect(isBinaryContentType('image/png')).toBe(true);
  });
});
