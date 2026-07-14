# §18.7 pre-check — provider data-URL and vision capability support

Research date: 2026-07-14. Verifies plan_v3.md §18.7 assumptions from official
docs plus one live catalog request. Live *generation* requests (one per
provider path, with a real image) remain to be done during Phase D since they
spend provider credit.

## OpenAI Responses API (direct path)

Source: https://developers.openai.com/api/docs/guides/images-vision

- `input_image.image_url` accepts base64 data URLs (`data:image/jpeg;base64,...`). ✅
- Formats: PNG, JPEG, WebP, non-animated GIF. Our JPEG/PNG/WebP subset is safe. ✅
- Limits: up to 512 MB total payload, up to 1,500 images per request — far
  above our 4 MiB / 4-image caps, so our extension-side limits are the binding
  constraint. ✅
- `detail` accepts `low`/`high`/`original`/`auto`; `low` (already used by AI
  Reply) remains valid. Note: newer GPT-5.6-era models tokenize images
  differently per detail level — re-check chart legibility at `low` during
  Phase F canary before locking it in.

## OpenRouter Chat Completions

Source: https://openrouter.ai/docs/guides/overview/multimodal/image-understanding

- `image_url.url` accepts base64 data URLs. ✅
- Formats: PNG, JPEG, WebP, GIF. ✅
- Max image count "varies per provider and per model" — no global number, so
  keep our own 4-image cap and treat provider rejects as `IMAGE_PROVIDER_ERROR`.
- Docs recommend text content part first, then images — matches the order both
  provider builders in `aiProvider.ts` already produce. ✅

## OpenRouter capability catalog (live check)

`GET https://openrouter.ai/api/v1/models` (2026-07-14): 343 models, every entry
exposes `architecture.input_modalities`; ~158 include `"image"`. The §18.7
capability resolver can rely on `input_modalities.includes("image")` for
OpenRouter models. The backend already fetches this catalog for
`modelSupportsParameter`, so vision capability can reuse that cached lookup.

## Direct-OpenAI capability

No machine-readable modality catalog on the direct path — keep the plan's
conservative static resolver (known vision model prefixes) plus the "unknown =
best effort, not confirmed" UI state.

## Existing code alignment

`apps/backend/src/services/aiProvider.ts` already builds exactly the shapes
§18.7 specifies for AI Reply `imageUrls` (OpenAI: `input_image` +
`detail: "low"`; OpenRouter: `image_url.url` + `detail: "low"`), and both paths
currently exclude images for Create Post requests via `isGeneratePostRequest`.
Phase D is therefore mostly: lift that exclusion for validated
`attachedImages`, passing data URLs through the same content-part builders.

## Remaining before Phase D sign-off

- One live generation request per path (OpenRouter + direct OpenAI) with a
  real chart data URL, per §18.7. Needs provider keys; do during Phase D.
- Confirm per-model image-count limits for the default models actually
  configured in production.
