# ScanOrigin — Handover Brief for Claude

> Written 2026-10-22 by Rupert (Graeme's build agent). This document assumes you have **zero** access to any prior workspace, VPS, or session history. Everything you need lives in this repo plus this brief. When this brief and anything else disagree, **the repo is the source of truth** and this brief explains the wiring around it.

---

## 1. What ScanOrigin is

A free, accountless **product origin checker**: scan a barcode (or type a brand name) and it tells you where the product/brand comes from, who ultimately owns it, and — for US-owned brands — suggests non-US alternatives (Canadian-first). There is also a curated "Tech Alternatives" list (Canadian/non-US alternatives to US tech products).

- **Product owner**: Graeme (private individual). The site must show **zero traces** of his name or personal Gmail — see §9 Privacy invariants.
- **Audience**: Canadian shoppers, mobile-first. The app is a PWA (installable).

## 2. Live URLs and infrastructure

| Piece | URL | Platform |
|---|---|---|
| Production frontend | https://scanorigin.ca | GitHub Pages, branch `main`, **root directory** |
| Staging frontend | https://scanorigin-staging.rupertclaw.workers.dev | Cloudflare Worker `scanorigin-staging` (serves `public/` as assets) |
| Product-lookup API | https://scanorigin-api.onrender.com | Render (Express, `server.js`) |
| AI proxy worker | https://truenorth-gemini-proxy.rupertclaw.workers.dev | Cloudflare Worker, repo `rupertclaw/truenorth-gemini-proxy` |
| Usage dashboard | `https://truenorth-gemini-proxy.rupertclaw.workers.dev/?usage=tripwire200` | same worker, GET |

GitHub: everything lives under the **`rupertclaw`** account (NOT `thaneclaw`, NOT `MaplePulse`).

- Repo `rupertclaw/scanorigin` — frontend + Render backend code + a dormant worker variant (§5).
- Repo `rupertclaw/truenorth-gemini-proxy` — the Cloudflare Worker that fronts Gemini.

## 3. Branching and deploy rules (non-negotiable)

- Branches: `main` = production (protected), `stage` = working branch.
- **Never push to `main`.** The user (Graeme) ships by merging PRs from `stage` → `main`, two clicks. Open PRs against `main` and always include the full PR URL (`https://github.com/rupertclaw/scanorigin/pull/N`) in your report to him.
- Before telling him a PR is ready, verify `mergeable_state: clean` via the API. **The GitHub mobile app shows "Unable to merge" on clean PRs routinely** — when he reports that, do NOT debug the branch. Re-check `mergeable_state`; if clean, treat his merge attempts as sign-off (or merge via API if he asks).
- After a merge, **verify production** by polling `https://scanorigin.ca/index.html` for the new feature's marker string (Pages lags ~1-2 min). A curl of the served HTML is the proof, not the merge response.
- UI changes Graeme should approve pre-merge: deploy the staging worker (§5.3) and give him the staging URL.

## 4. The repo layout (frontend)

```
scanorigin/
├── index.html          ← 153 KB single-file app: ALL frontend code is inline here.
│                          This is the file Pages serves and the ONLY place to make
│                          user-facing frontend changes (see §5.1 for the public/ copy).
├── public/             ← mirror copy of the frontend, served by the Cloudflare staging
│   ├── index.html        worker. MUST be kept in sync (§5.1).
│   └── sw.js
├── sw.js               ← service worker (cache-first PWA). Version-bump rule in §5.2.
├── manifest.json       ← PWA manifest (linked with `manifest.json?v=16` — bump the query
│                          when you change the manifest, same reason as sw version).
├── server.js           ← Render backend: Express, /api/lookup, /api/enrich, /health.
├── package.json        ← main: server.js (this is what Render runs).
├── wrangler.jsonc      ← production worker config (name "scanorigin"). NEVER DEPLOYED;
├── src/index.ts          dormant/local-only (§5.4). Don't build on it without asking.
├── wrangler.staging.jsonc ← staging worker config (name "scanorigin-staging", assets ./public).
├── CNAME               ← scanorigin.ca (Pages custom domain).
├── robots.txt, sitemap.xml
└── *.png               ← icons/logo/donate badge.
```

Single-file architecture is deliberate. There is no build step, no bundler, no framework. Do not introduce one. Syntax-check every inline `<script>` block with `node --check` (or `new Function(src)`) before committing; skip the JSON-LD block.

## 5. Critical frontend gotchas

### 5.1 TWO copies of index.html exist and must stay in sync
- `index.html` (root) → what GitHub Pages serves in production.
- `public/index.html` → what the Cloudflare staging worker serves.

**After every change to `index.html`, copy it to `public/index.html`.** Skipping this silently produces a staging build that doesn't match production. (A real example: the install-counter commit touched only root; `public/` stayed stale until it was caught and synced.)

Also: `wrangler.jsonc` (the never-deployed production worker config) points assets at `./public`, so if anyone ever deploys worker name `scanorigin`, the served page is `public/index.html`. Keep the sync discipline either way.

### 5.2 Service worker cache version bump
After ANY edit to `index.html`: bump `CACHE_NAME` in **both** `sw.js` and `public/sw.js` (`scanorigin-vN` → `vN+1`). Skipping this means returning PWA users silently keep the old code for days. As of this handover the version is **`scanorigin-v34`**.

### 5.3 Staging deploy
```
npx wrangler deploy --config wrangler.staging.jsonc
```
→ https://scanorigin-staging.rupertclaw.workers.dev — use this for UI changes Graeme should approve pre-merge.

### 5.4 The dormant production worker
`wrangler.jsonc` + `src/index.ts` define a Worker named `scanorigin` that combines asset serving with its own `/api/lookup` + `/api/enrich`. It was **never deployed** (verified: the script does not exist on the Cloudflare account). It is a partial snapshot of old backend logic — treat it as dead weight, don't edit it expecting changes to go live.

## 6. Product-data architecture

### 6.1 Barcode lookup
1. Client calls Render `GET https://scanorigin-api.onrender.com/api/lookup?barcode=…`.
   - `server.js` fan-outs, in order: Open Food Facts → Open Beauty Facts → UPCitemdb → DuckDuckGo snippets → CodeLook. Enriches with Wikipedia (`fetchWikipediaData`).
2. If Render is down/empty, the client itself fetches Open Food Facts, then Open Beauty Facts directly.
3. `GET /health` returns `{"status":"ok",...}` (note: on Render Starter the service can spin down; first request may take ~30-60s to cold-start).

### 6.2 GS1 prefix lookup
`gs1Lookup()` in `index.html` maps barcode prefixes (400-999 table) to a country + flag. This is **where the barcode was registered**, not necessarily where the brand is owned. Confidence display reflects that: label/manufacturing data beats GS1 country.

### 6.3 Brand / ownership pipeline (brand tab)
For a typed brand name, `index.html` runs (roughly):
1. **BRAND_DB** — an inline curated map (~220 well-known brands → company/country).
2. **Gemini ownership lookup** (`__ownership__` mode of the AI worker, §7) — primary source now.
3. **GLEIF chain tracing** — `https://api.gleif.org/api/v1/lei-records`, tracing parent relationships up to 5 levels.
4. **Wikipedia** — cross-check + fallback for brands not in GLEIF; also parent enrichment.
5. `assessCanadianStatus(chain)` decides US-owned / Canadian-owned / Independent, and the result renders with a confidence level.

### 6.4 Discover mode (`__discover__`)
Free-text "find non-US options for X". **Two passes on the worker**:
1. Generate up to 8 candidate brands for the query — **without filtering by ownership**.
2. One batched call verifies each candidate's ultimate parent; the worker drops US-owned entries server-side.

**Never move the ownership pre-filter into the generation prompt** — the model gets paranoid and returns empty lists. Client badges answer "who OWNS it" (Canadian-owned / UK-owned / Independent) with a `-born` suffix only when birthplace differs from owner country. Do NOT show birth origin in an ownership list — to users that reads as a bug (the Sensodyne case).

### 6.5 Tech Alternatives list
Hand-curated `techAlternatives` array in `index.html` (~41 entries: us product → Canadian/EU alternative, url, desc, cat, tags). **It rots.** Before trusting any entry in an edit, or when a user reports a "site not secure" warning or fishy results, audit the outbound links: a "not secure" browser warning where the site's own cert checks out usually means a **dead outbound link** (NXDOMAIN → browser lands somewhere unsecured), not a cert problem. Verify scanorigin.ca's cert first, then audit the links.

### 6.6 Ingredient translation
Non-English ingredient lists go to the worker's `__translate__` mode.

## 7. The AI worker (truenorth-gemini-proxy)

Repo `rupertclaw/truenorth-gemini-proxy`, single file `src/index.js` (~550 lines), plain JS (not TS). Deploy: `npx wrangler deploy` from that repo (no staging config exists; additive modes are safe to ship direct). **Test the deployed endpoint with curl + `Origin: https://scanorigin.ca` header before committing client code that calls it.**

### 7.1 Endpoint modes (all POST except the dashboards)
- Body `{brand: "__ownership__", text: "<brand>"}` → `{brand, originCountry, parentCompany, parentCountry, confidence, note}`.
- Body `{brand: "__discover__", text: "<query>"}` → `{query, results:[{name, originCountry, parentCompany, parentCountry, confidence, note}], filtered}`.
- Body `{brand: "__translate__", text: "<ingredients>"}` → `{translation}`.
- Body `{brand: "<name>", category: "..."}` → alternatives mode `{alternatives:[{name, origin, note}]}`.
- GET `/?usage=tripwire200` → 7-day usage history + tripwire flag.
- GET `/?installs=1` → 7 days of PWA install counts.
- POST `/track-install` → increments the install counter (fired by the frontend on `appinstalled`).

**Order matters**: the GET dashboards (`?usage=`, `?installs=1`) and `/track-install` are registered BEFORE the `!allowedOrigin` 403 gate. If you curl the dashboard without special headers it must still work. If you move code below the gate, curls will 403 and it will look broken when it isn't.

### 7.2 CORS
`ALLOWED_ORIGINS`: scanorigin.ca (+www), rupertclaw.github.io, the staging worker, localhost:8000. Requests with no matching Origin → 403.

### 7.3 Testing gotcha (important)
Reproducing client errors with curl on datacenter IPs (like this server) needs BOTH `Origin: https://scanorigin.ca` AND a mobile browser UA — otherwise the CORS gate 403s and you misdiagnose. That 403 is the test rig's problem, not the site's. **Never call Gemini directly from local scripts with a key from .env — the key exists only as a Cloudflare secret. Test through the deployed worker.**

### 7.4 Cost control and resilience
- **Response cache**: in-memory per isolate, TTL 6h, keyed on brand+category (~halves Gemini spend).
- **Model fallback chain**: `gemini-3.8-flash → 3.5-flash → 2.5-flash → 2.0-flash → flash-lite-latest`. Free-tier quota is **per model**, so chain depth = resilience. **Keep the chain at 5+ models** — two entries means one drained pool takes the service down for the rest of the day (quota resets midnight Pacific). A 404 on a chain model is permanent (bad model name), not quota — remove it.
- **Stale-cache fallback**: when every pool is drained (all 429), the worker serves a stale cached response instead of an error (reaching past TTL into the raw response cache). A day-old alternative list beats a dead feature.
- **Rate limit**: 10 req/min per IP — the spend guardrail. Worst-case abuse is bounded dollars/day.
- **Usage tripwire**: counts real Gemini calls per UTC day in KV (`USAGE_KV`). Dashboard above shows totals by mode + a flag at **200 calls/day**. At the tripwire, upgrade the AI Studio key to paid tier (one toggle in AI Studio settings, no code changes; paid 2.5-flash ≈ $0.0006/search → ~$10/mo at 500/day). Below the tripwire, the free chain holds. Counts are eventually consistent (~60s KV lag): fine for a tripwire, wrong for billing. Cache hits and stale serves don't count.
- **Worker signature must be `(request, env, ctx)`** — omit `ctx` and every `waitUntil` silently no-ops while deploys keep succeeding. Track usage with `ctx.waitUntil(trackGeminiCall(env, mode))` at each mode's success-parse point, exactly once per request (even if it retried down the chain).

## 8. Verification degradation (trust-product rule)

When the Gemini layer is down or drained, a raw GLEIF registry name match is **NOT verification** — GLEIF is a business registry full of unrelated same-name companies (a food brand once resolved to a foreign packaging company). Two rules:
1. The worker degrades gracefully first: longer chain, then stale cache. Only then may the client fall back.
2. The client must **downgrade displayed confidence** when verification is missing: show `Confidence: unverified` plus a plain-English warning that the match is a registry name match and may not be the brand the user meant. NEVER keep the original confidence on an unverified fallback. Honest gap beats confident nonsense — silent degradation dressed as certainty is the worst failure mode for this product.

Same philosophy elsewhere: a user-reported dead link in Tech Alternatives gets fixed or removed, not left to rot.

## 9. Privacy invariants (hard rules)

- Zero traces of the owner's name or personal email anywhere user-facing. The About modal says the site is run by "a retired Canadian individual who is a hobby developer". After ANY copy change, grep the served production HTML.
- Contact flows go through the Formspree feedback form (`https://formspree.io/f/xaqglnpa` in `index.html`). That inbox is **shared with the Vaulted Roots project** — the `_subject` field distinguishes senders. Don't change it without asking.
- The Facebook link stays — the owner explicitly kept it.
- No cookies, no accounts, no user identifiers. The install counter is deliberately anonymous (no cookies, no identifiers; iOS installs are not counted because Safari exposes no `appinstalled` event).
- Google Analytics exists (`G-29827H2J1K`, gtag in `index.html`). Standard config.

## 10. Secrets and credentials map

- `GEMINI_API_KEY` — Cloudflare secret on `truenorth-gemini-proxy` only (`wrangler secret put GEMINI_API_KEY`). Never anywhere else.
- `USAGE_KV` — KV namespace binding in `wrangler.toml` (id `d38def9fbea0440b830f68d51ab6d7a1`).
- GitHub pushes: a fine-grained PAT belonging to `rupertclaw` (Graeme's agent credentials). `gh` CLI on this machine may be a different account — don't rely on it.
- Render deploys: manual via the Render dashboard (auto-deploy proved unreliable). Render runs `npm start` → `server.js`.
- No other keys exist. If you need a new secret, add it as a Cloudflare secret, not in code.

## 11. Current state at handover (2026-10-22)

- Local changes pushed. PR open: **https://github.com/rupertclaw/scanorigin/pull/13** (stage → main): the anonymous install counter (commit `2be7612`), public/index.html sync + sw bump to v34 + `wrangler.staging.jsonc` added to the repo (commit `5c09b5d`). Verified mergeable via API at time of writing.
- Worker repo `truenorth-gemini-proxy` is fully pushed (`master` @ `1ffe7b3`, deploy included `/track-install` + `/?installs=1` + KV usage tracking).
- Production Render API healthy (`/health` 200).
- No unpushed work anywhere. If you find a local file in this repo uncommitted, that's your first job.

## 12. Debugging recipes that have actually worked

1. **Reproduce from the user's exact input** (same endpoint, same payload shape) before theorizing. One screenshot of one search can show two independent bugs (degraded verification layer AND a wrong fallback answer) with one root cause.
2. **GLEIF `filter[entity.legalName]`** is a name match across ALL global companies. An unrelated foreign company sharing the brand name is a normal hit, not evidence about the brand.
3. **"Site not secure" reports** → check scanorigin.ca's cert first; usually a dead outbound Tech-Alternatives link (§6.5).
4. **"Alternatives service is busy" all day** → a drained quota pool; that's what the long chain + stale cache protects against. Check `?usage=tripwire200`.
5. **Feature works on staging but not for returning users** → sw cache version wasn't bumped (§5.2).
6. **Everything looks broken from a script but works on the phone** → missing `Origin` header / desktop UA on a datacenter IP (§7.3).

## 13. Style expectations when working with Graeme

- Plain English, no jargon. Analogies over acronyms. Short replies.
- Ack first ("on it"), then do the work, then report with evidence (URLs, curl outputs, PR links).
- Include the full PR URL every time a PR exists.
- Never claim "done" without verification (curl the live file, check the mergeable state).
- He ships PRs himself — stage → main merges are his two clicks, not yours.