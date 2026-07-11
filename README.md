# TokenDiet MCP

TokenDiet is a local MCP server that compresses file reads, command output, search hits, and fetched web pages **before** they enter the agent context. It uses deterministic transforms (outline, log dedup, snippet caps) and a safety verifier that rolls back when compression would drop protected content or fail to shrink the payload. Token counts use a real BPE encoder (`o200k_base` by default), not character guesses. Dogfood benchmarks include real M7 agent sessions; internal sprint docs are not published.

This only helps when the agent gets data **through** TokenDiet tools. If built-in Read or Bash already loaded the full text into context, calling compress afterward cannot undo that cost.

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

## Tools

| Tool | Role |
|------|------|
| `read` | Compressed file read; `outline` / `signatures` / `symbol` for code |
| `run` | Shell command with compressed stdout/stderr |
| `search` | Ripgrep with JS fallback; compressed snippets |
| `fetch` | HTTP fetch with HTML/JSON/text compression |
| `expand` | Full content from a prior `ref` |
| `stats` | Session and all-time token accounting |

## What to expect (honest ranges)

Measured on our dogfood corpus (`benchmarks/`), not a universal promise:

- Code outline / symbol first reads: often **65–96%** fewer tokens than raw file text
- Test and log output via `run`: often **68–99%**
- First full read of unchanged file in a new MCP process: **0%** (nothing was in context yet)
- Small `search` result sets: may use raw passthrough when compression overhead would not pay off

See `benchmarks/2026-07-11-dogfood-v3.md` for methodology (BPE rules, what counts as savings, verifier behavior).

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
node scripts/check-disclosure.mjs
```

## License

MIT — see [LICENSE](LICENSE).
