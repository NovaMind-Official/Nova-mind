# Phraortes

**A single-file, production-grade AI intelligence interface — built for NovaMind.**

Phraortes is a self-contained conversational AI client that combines a multi-core model system, adaptive UI moods, subscription-gated access, and a secure server-side AI gateway — delivered as one dependency-light HTML application.

---

## Overview

| | |
|---|---|
| **Product** | Phraortes — Intelligence Interface |
| **Distribution** | NovaMind |
| **Architecture** | Single-file client (HTML/CSS/JS) + Cloudflare Worker API gateway |
| **AI Provider** | OpenRouter (proxied — never called directly from the client) |
| **Deployment target** | Static hosting (GitHub Pages) |

Phraortes is designed to run entirely client-side with zero build step, while keeping every credential — AI provider keys included — off the client and out of source control.

---

## Core Capabilities

### Multi-Core Model System
Four distinct reasoning cores, each tuned to a use case and gated by subscription tier:

| Core | Codename | Behavior |
|---|---|---|
| 2.4 | **Prime** | Default, general-purpose conversation |
| 2.5 | **Intellect** | Deep research and analysis, serif reading mode |
| 2.6 | **Apex** | Code-focused, monospace workspace mode |
| 2.7 | **Sovereign** | Full-scope professional work, dedicated visual theme |

### Adaptive Interface
- Real-time **mood-reactive theming** (cyber, vapor, crimson, gold, nordic, and more) driven by conversation sentiment
- Dedicated **light and dark themes**
- Per-core visual modes — workspace (monospace), intellect (serif), sovereign (dedicated palette)
- **Zen Mode** for distraction-free sessions

### Conversation Engine
- Streaming responses with live token rendering
- Persistent chat history and session search
- Inline source drawer for cited/researched answers
- Virtual code editor for viewing and searching generated code
- Prompt enhancement presets (artistic, engineering, academic, localized business)
- Canvas mode for structured, editable AI output

### Multimodal
- Document ingestion (PDF, DOCX) parsed client-side
- Image-aware conversation via vision-capable models
- AI image generation
- **Aura** — live voice interaction mode with real-time waveform visualization

### Identity & Monetization
- Google OAuth sign-in
- Four-tier subscription model (Free / Satrap / Immortal / Shahanshah) with per-tier message limits, model access, and rate refresh windows
- Cryptocurrency payment flow with QR-based wallet checkout
- Client-side payment verification layer (`payment-verify.js`)

### Localization
- Full bilingual support, including native Persian (Farsi) prompt tooling

---

## Architecture

```
┌─────────────────────┐        HTTPS POST         ┌──────────────────────────┐        HTTPS         ┌────────────┐
│   Phraortes Client   │ ─────────────────────────▶│   Cloudflare Worker      │ ─────────────────────▶│ OpenRouter │
│   (GitHub Pages)     │   { model, messages }      │   (API Gateway)          │   Bearer <AI_API_KEY>  │            │
│                       │◀─────────────────────────  │                          │◀─────────────────────  │            │
└─────────────────────┘        JSON response         └──────────────────────────┘                        └────────────┘
```

**The client never holds, transmits, or exposes an AI provider API key.** All model requests are routed through a dedicated Cloudflare Worker, which injects the OpenRouter credential server-side from an encrypted Cloudflare secret. This is the only AI integration path in the project — there is no fallback provider and no client-side key of any kind.

| Component | Role |
|---|---|
| `phraortes.html` | Full application — UI, chat engine, state, plan logic |
| `security.js` | Client-side security utilities |
| `payment-verify.js` | Payment verification logic |
| Cloudflare Worker (`/api/chat`) | Sole AI gateway — holds `AI_API_KEY` as a server-side secret |

---

## Security Model

- **Zero client-side secrets.** No API keys, tokens, or credentials are present anywhere in the delivered frontend.
- **Single egress path.** All model traffic is funneled through one authenticated gateway endpoint; there is nothing else in the client that talks to an AI provider.
- **Strict Content-Security-Policy** enforced via meta tag — script, style, and font origins are explicitly allow-listed.
- **Input sanitization** via DOMPurify for all rendered AI output.
- **Secrets stay out of Git.** The Worker's credential is set with `wrangler secret put`, never committed to source control.

---

## Deployment

### Frontend
Static — deploy `phraortes.html` (with `security.js` and `payment-verify.js` alongside it) to any static host. Currently served via GitHub Pages.

### API Gateway (Cloudflare Worker)
```
your-worker-project/
├── src/
│   └── index.js          # Worker entry point
└── wrangler.jsonc         # Worker configuration
```

```jsonc
{
  "name": "phraortes-api",
  "main": "src/index.js",
  "compatibility_date": "2026-08-30"
}
```

```bash
wrangler secret put AI_API_KEY     # set the OpenRouter key server-side, once
wrangler deploy                    # ship the Worker
```

**Live endpoint:** `https://phraortes-api.esmaeilimatin20.workers.dev/api/chat`

---

## Tech Stack

- Vanilla JavaScript — no framework, no build step
- `marked` — Markdown rendering
- `highlight.js` — syntax highlighting
- `pdf.js` / `mammoth.js` — document parsing
- `DOMPurify` — output sanitization
- Cloudflare Workers — edge API gateway
- OpenRouter — model routing and inference

---

## License

© NovaMind. All rights reserved.
