<div align="center">

# Wardrobe

Your clothes, extracted and organized with gpt-image.

[![License: MIT](https://img.shields.io/badge/license-MIT-191919?style=flat-square)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-191919?style=flat-square)](package.json)

[See the original post →](https://x.com/cdngdev/status/2076812846793650485)

</div>

![Wardrobe gallery](docs/screenshots/gallery.png)

![Modeled wardrobe editor](docs/screenshots/editor.png)

## Quick start

```bash
git clone https://github.com/tandpfun/wardrobe.git
cd wardrobe
npm install
cp .env.example .env
codex login status
npm run dev
```

The importer uses your locally installed, signed-in Codex CLI by default, so an
`OPENAI_API_KEY` is not required. If `codex login status` is not signed in, run
`codex login`. Also place a clear PNG reference photo of yourself at
`data/model-reference.png`; it remains ignored by Git.

Open [localhost:5173](http://localhost:5173).

The web server binds to `127.0.0.1` and the import API rejects non-loopback
requests. “Local” here means the app, originals, generated files, and database
stay on this machine and the UI is not exposed to your LAN. Codex still sends
the attached image and prompt to OpenAI to perform model inference.

## Import with Codex

This repo includes two Codex skills: one imports clothes and generates modeled item photos; the other styles complete outfits and generates a modeled lookbook.

```text
$import-clothes Import the clothes from ~/Pictures/outfits, create modeled photos, and add them to this wardrobe.
$generate-outfits Create modeled outfit ideas from my wardrobe.
```

Open the cloned repo in Codex and run either prompt. The import skill asks for a local model-reference PNG when needed, reviews every cutout and modeled photo, then writes to `data/library.json` and `data/imported/`. The outfit skill asks how many looks to create, then curates, generates, verifies, and saves the complete collection under `data/`.

### For agents

If you are setting up Wardrobe for a user, ask how they want to import their clothes:

- **Codex:** Ask for a folder or camera-roll location and a model-reference PNG, then extract, model, and import the individual pieces by following [the bundled import skill](.agents/skills/import-clothes/SKILL.md). Afterward, offer to create a requested number of modeled looks with [the outfit-generation skill](.agents/skills/generate-outfits/SKILL.md).
- **Web UI:** Prefer the user's signed-in local Codex session and
  `data/model-reference.png`; configure `OPENAI_API_KEY` only when they
  explicitly choose the API-provider fallback.

## Import providers

`WARDROBE_IMPORT_PROVIDER=auto` prefers the signed-in Codex CLI and falls back
to the API-key provider only when Codex is unavailable and an API key is
configured. It does not silently switch providers in the middle of a job.

- `codex` — require a local Codex installation authenticated with ChatGPT.
  Vision input and native image generation must be available in that Codex
  installation. Each run is ephemeral and sandboxed to its import job folder.
- `api` — use the original Responses and Images API implementation with
  `OPENAI_API_KEY`.
- `auto` — prefer Codex; otherwise select the API provider during setup.

If Codex can inspect photos but its native Image Generation capability is not
available, the job fails with a specific message instead of creating a fake
asset. Enable that built-in capability or explicitly choose the API provider.

## What it does

- Detects every garment with a signed-in Codex session or the Responses API
- Extracts clean product cutouts with native Codex image generation or the Images API
- Generates an optional modeled editorial preview
- Keeps originals, jobs, generated images, and the JSON database local in `data/`
- Supports drag, drop, paste, editing, review, regeneration, and approval

## Configuration

| Variable | Default |
| --- | --- |
| `WARDROBE_IMPORT_PROVIDER` | `auto` |
| `WARDROBE_CODEX_BIN` | `codex` |
| `WARDROBE_CODEX_MODEL` | Codex default |
| `WARDROBE_CODEX_ANALYSIS_TIMEOUT_MS` | `120000` |
| `WARDROBE_CODEX_IMAGE_TIMEOUT_MS` | `300000` |
| `OPENAI_API_KEY` | Optional API-provider fallback |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` |
| `OPENAI_IMAGE_QUALITY` | `high` |
| `WARDROBE_MODEL_REFERENCE` | `data/model-reference.png` |
| `WARDROBE_DATA_DIR` | `data` |
| `WARDROBE_HOST` | `127.0.0.1` |

## License

[MIT](LICENSE)
