# TokenDiet MCP

TokenDiet is a local MCP server that compresses file reads, command output, search hits, and fetched web pages **before** they enter the agent context. It uses deterministic transforms (outline+, log dedup, snippet caps) and a safety verifier that rolls back when compression would drop protected content or fail to shrink the payload. Token counts use a real BPE encoder (`o200k_base` by default), not character guesses.

This only helps when the agent gets data **through** TokenDiet tools. If built-in Read or Bash already loaded the full text into context, calling compress afterward cannot undo that cost.

## Two value propositions (honest)

1. **Billed cost** — savings on profile workloads (logs, web pages, large files, batch reads) when the agent uses TokenDiet tools **without extra MCP turns**. On small files or drill-down ladders, billed cost can be **higher** than baseline; the server-side economic guard and batch API exist to prevent that. See `benchmarks/2026-07-25-e2e-turn-neutral.md`.
2. **Context window budget** — fewer fresh tokens per turn delays context summarization in long sessions. This benefit is independent of cache pricing and applies even when billed cost is neutral.

**Turn-neutral rule (v0.7.0):** compression must not multiply agent turns. Implemented via economic guard (`T_full` ≈ 3K BPE), `read(targets[])` batching, outline+ (not outline→expand ladders), and optional shrink proxy for upstream MCP servers.

`verified: true` means structure verified — check `warnings`, `omitted.bodies`, and `compression.net_estimate` before editing code.

## Install (from source)

Requires **Node.js 20+** and build tools for `better-sqlite3` (native addon).

```bash
git clone https://github.com/DukeDeSouth/tokendiet-mcp.git
cd tokendiet-mcp
npm install
npm run build
```

Wire Cursor (example — adjust paths after clone):

```bash
node dist/index.js setup --client cursor --project /path/to/your/project
```

Reload MCP servers in Cursor. Point agents at `read`, `run`, `search`, `fetch`, `expand`, and `stats` instead of raw Read/Grep/Bash for large payloads.

## Shrink proxy (wrap upstream MCP servers)

TokenDiet can sit **between Cursor and another MCP server** and compress results **inside the same tool round-trip** (no extra agent turns). This does **not** intercept built-in Cursor/Codex tools — only MCP servers you wrap.

```bash
# Example: wrap Playwright MCP
tokendiet-mcp shrink -- npx @playwright/mcp@latest
```

Cursor `mcp.json` (stdio) — replace the upstream command with the shrink wrapper:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "node",
      "args": ["/absolute/path/to/tokendiet-mcp/dist/index.js", "shrink", "--", "npx", "@playwright/mcp@latest"]
    }
  }
}
```

Optional: `TOKENDIET_SHRINK_SERVER=playwright` selects a profile from `shrink.config.json` (allowlist/denylist, `min_text_tokens`, content hints).

**What gets compressed:**
- `tools/list` — long tool `description` strings (schema overhead)
- `tools/call` — large **text** content blocks; images/resources pass through byte-safe

Compressed blocks append `[compressed by tokendiet — expand(<ref>) for full]`. Retrieve the original via the TokenDiet `expand` tool when the main TokenDiet MCP server is also configured.

See `shrink.config.json` for per-upstream tuning.

## Tools

| Tool | Role |
|------|------|
| `read` | Batch file read (`targets[]`); `outline_plus` / `signatures` / `symbol` for code |
| `run` | Shell command with compressed stdout/stderr |
| `search` | Ripgrep with JS fallback; compressed snippets |
| `fetch` | HTTP fetch with HTML/JSON/text compression |
| `expand` | Full content from a prior `ref` |
| `stats` | Session and all-time token accounting |

## What to expect (honest ranges)

Measured on our dogfood corpus and E2E harness (`benchmarks/`), not a universal promise:

- **Turn-neutral N-corpus (offline sim):** v2 policy turns_ratio **0.38**, cost_ratio **0.36** vs baseline
- **User A/B v1 (documented failure):** turns_ratio **4.42**, cost_ratio **2.36** — why v0.7.0 exists
- Test and log output via `run`: often **68–99%** payload saved
- Shrink proxy (Playwright snapshot sim): **≥50%** saved, **0** extra turns
- Small files (< ~3K BPE): server returns **full** content; use built-in Read or batch `targets[]`
- `stats.net_tokens_estimate` subtracts turn cost — negative means the call was economically unprofitable

See `benchmarks/2026-07-11-dogfood-v3.md` and `benchmarks/2026-07-25-e2e-turn-neutral.md` for methodology.

## Limitations

- AST outline modes: TypeScript, JavaScript, Python (via tree-sitter WASM bundled in `wasm/`)
- `search` without `rg` installed uses a slower JS walker (respects `.gitignore`)
- `fetch` does not execute JavaScript; private IPs are blocked (SSRF hygiene)
- BPE counts approximate Claude/Gemini tokenizers; relative savings are still meaningful because in/out use the same encoder (`docs/TOKENIZER.md`)
- Ref cache under `~/.tokendiet/refs` (TTL/size capped via env) — local only, no cloud

## Privacy

Everything runs on your machine over stdio. No telemetry, no remote compression service.

## Development

```bash
npm test
npm run e2e:gate
npm run check-disclosure
```

## License

MIT — see [LICENSE](LICENSE).
