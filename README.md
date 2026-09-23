# Phraortes

**A single-file, production-grade AI intelligence interface.**

Phraortes is a self-contained conversational AI client that combines a
multi-core model system, real-time streaming, interactive study artifacts
(graphs, physics simulations, step-by-step math solutions), a secure
server-side AI gateway, and subscription-gated access — delivered as one
dependency-light HTML application with no build step and no framework.

🔗 **Live:** https://novamind-official.github.io/Nova-mind/

---

## Features

- **Multiple AI cores** — Prime, Intellect, Apex, and Sovereign engines,
  gated by subscription tier (Satrap / Immortal / Shahanshah), each with its
  own reasoning depth and monthly usage limits.
- **Real streaming responses** — answers appear token-by-token over SSE,
  with automatic retry and recovery if the connection stalls.
- **Live tools** — real-time web search, current weather, crypto prices,
  reading full web pages, and a per-chat file workspace, all invoked by the
  model itself mid-conversation with a visible step-by-step trace.
- **Study artifacts** — for math, physics, and science questions, answers
  can include:
  - Interactive function/parametric/polar **graphs** (pan, pinch-zoom, tap
    to trace values, automatic root and intersection detection, shaded
    area under a curve)
  - Live **physics simulations** (projectile motion, pendulum, spring-mass,
    waves, inclined plane) with real-time sliders
  - **Step-by-step worked solutions**, revealable one step at a time
  - **Practice quizzes** with instant feedback and scoring
  - **Flashcards**
  - All math is rendered as proper LaTeX via a self-hosted KaTeX (no
    external CDN dependency)
- **Installable PWA** — add-to-home-screen support, offline shell via a
  service worker, and native-feeling navigation.
- **Subscription payments** — plan tiers with usage-based limits and
  crypto payment support.
- **Sanitized by design** — all model and web content is rendered through
  DOMPurify with a locked-down content policy; no inline event handlers,
  no unsafe HTML ever reaches the DOM.

## Tech stack

Vanilla HTML/CSS/JS. No React, no bundler, no build step. A handful of
small, focused companion files instead of one giant blob:

```
index.html          → the app itself (UI, chat logic, state)
security.js          → sanitization, Markdown + LaTeX rendering pipeline
artifacts.js         → graph / simulation / solution / quiz / flashcard widgets
payment.js           → subscription + crypto payment flow
manifest.webmanifest  → PWA metadata
sw.js                → service worker (offline shell, asset caching)
katex.min.js/css + KaTeX_*.woff2 → self-hosted math rendering (no CDN)
icon-*.png           → app icons
```

The backend is a small Cloudflare Worker that proxies chat requests to the
underlying model provider, keeping API keys off the client.

## Running it yourself

This is a static site — clone the repo and open `index.html`, or serve it
with any static host (GitHub Pages, Cloudflare Pages, etc.). You'll need
your own Worker endpoint for the AI backend; update the gateway URL in
`index.html` to point at it.

## A note on how this was built

This project was built with heavy use of AI-assisted development. Being
upfront about that rather than hiding it — happy to answer questions about
the process, architecture decisions, or anything else.

## License

All rights reserved © 2026 NovaMind. *(Update this if you decide to
open-source part or all of it — ask before assuming MIT/Apache terms.)*
