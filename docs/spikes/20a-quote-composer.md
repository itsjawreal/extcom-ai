# Spike 20-A — Quote composer markup and quoted-tweet extraction (browser-real)

Goal (plan_v3.md §20.4 / §20.9): record, in a real logged-in X session, the
actual markup of the Quote composer — route, dialog structure, testids of the
embedded quoted-tweet preview, and whether its text/author/images/language are
readable. The result decides the detection selector (`kind: "quote"`) and the
extraction anchors. No API/UI changes ship from this spike.

## How to run

1. Open x.com in Chrome, logged in, DevTools console on the top frame.
2. Paste the probe snippet below (defines `eksQuoteSpike`).
3. Open a Quote composer (repost menu → Quote on any tweet).
4. Run `await eksQuoteSpike.probe()` and paste the JSON output below.
5. Repeat for each scenario in the matrix.

## Probe snippet

```js
window.eksQuoteSpike = (() => {
  const EDITABLE = '[data-testid^="tweetTextarea_"], [role="textbox"][contenteditable="true"]';

  function shortPath(root, el) {
    const parts = [];
    for (let node = el; node && node !== root; node = node.parentElement) {
      const t = node.getAttribute && node.getAttribute("data-testid");
      if (t) parts.unshift(`${node.tagName.toLowerCase()}[data-testid="${t}"]`);
    }
    return parts.join(" > ") || "(no data-testid ancestors)";
  }

  function describePreviewCandidate(dialog, node) {
    const textNode = node.querySelector('[data-testid="tweetText"]');
    const userNames = [...node.querySelectorAll('[data-testid="User-Name"] span')]
      .map((s) => s.textContent.trim()).filter(Boolean).slice(0, 4);
    const photos = [...node.querySelectorAll("img")]
      .map((img) => img.currentSrc || img.src)
      .filter((src) => /twimg\.com\/media\//.test(src))
      .slice(0, 4);
    return {
      anchor: shortPath(dialog, node),
      tag: node.tagName.toLowerCase(),
      testid: node.getAttribute("data-testid"),
      role: node.getAttribute("role"),
      hasTweetText: Boolean(textNode),
      tweetTextLang: textNode ? textNode.getAttribute("lang") : null,
      tweetTextSample: textNode ? textNode.textContent.trim().slice(0, 120) : null,
      userNameSpans: userNames,
      mediaImageUrls: photos.map((u) => u.slice(0, 100)),
      timeElement: Boolean(node.querySelector("time")),
      linksToStatus: Boolean(node.querySelector('a[href*="/status/"]')),
    };
  }

  async function probe() {
    const report = { url: location.href, at: new Date().toISOString(), dialogs: [] };
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const editable = dialog.querySelector(EDITABLE);
      if (!editable) continue;
      const rec = {
        hasTweetButton: Boolean(dialog.querySelector('[data-testid="tweetButton"]')),
        editablePlaceholder: editable.getAttribute("aria-label") ||
          editable.getAttribute("data-placeholder") || null,
        // Every unique data-testid inside the dialog — this is the ground
        // truth for choosing the quote-preview detection selector.
        allTestids: [...new Set([...dialog.querySelectorAll("[data-testid]")]
          .map((n) => n.getAttribute("data-testid")))].sort(),
        // The old exclusion selector §20.1 says no longer matches:
        legacyTweetTestidPresent: Boolean(dialog.querySelector('[data-testid="tweet"]')),
        previewCandidates: [],
      };
      // Candidate containers for the quoted preview: anything holding a
      // tweetText or User-Name that is NOT the composer's own toolbar area.
      const seen = new Set();
      for (const inner of dialog.querySelectorAll('[data-testid="tweetText"], [data-testid="User-Name"], time')) {
        let container = inner.parentElement;
        for (let d = 0; container && d < 10; d += 1, container = container.parentElement) {
          const t = container.getAttribute("data-testid");
          if (t || container.getAttribute("role") === "link") break;
        }
        if (container && !seen.has(container)) {
          seen.add(container);
          rec.previewCandidates.push(describePreviewCandidate(dialog, container));
        }
      }
      report.dialogs.push(rec);
    }
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  return { probe };
})();
"eksQuoteSpike ready — run: await eksQuoteSpike.probe()";
```

## What each field proves

- `allTestids` → the complete testid vocabulary of the quote dialog; pick the
  detection selector from what is actually there, not from guesses.
- `legacyTweetTestidPresent: false` → confirms §20.1's diagnosis (the old
  `[data-testid="tweet"]` exclusion is dead); `true` → the exclusion still
  fires sometimes and detection must handle both.
- `previewCandidates[].hasTweetText` + `tweetTextSample` → quoted text is
  readable; `tweetTextLang` → language attr availability for §20.5
  `sourceLanguage`.
- `userNameSpans` → author name/handle extraction viability.
- `mediaImageUrls` → quoted tweet's images are https CDN URLs usable like
  reply `imageUrls`.
- `linksToStatus` → a stable way to identify the preview (it links to the
  quoted status) even if testids churn.

## Scenario matrix (record JSON output per row)

| # | Scenario | Steps | Result |
|---|----------|-------|--------|
| 1 | Quote a text-only tweet | repost menu → Quote → probe | |
| 2 | Quote a tweet with images | same, on an image tweet (expect mediaImageUrls) | |
| 3 | Quote an image-only tweet (no caption) | expect hasTweetText false/empty | |
| 4 | Quote + own attached image | attach an image to the quote → probe (both §18 attachments and preview visible?) | |
| 5 | Plain modal composer (control) | open /compose/post without quoting → probe (previewCandidates should be empty) | |
| 6 | Quote of a quote (nested) | quote a tweet that itself quotes → probe (which preview level is exposed?) | |

## Recording results

Paste each probe JSON under a `### Scenario N` heading below, with Chrome
version and date. Conclude with the chosen detection selector and extraction
anchors for Phase B.

## Caveats

- DevTools runs in page context; the content script shares the DOM, so
  results transfer (same as spike 18-A).
- Record `anchor` values verbatim — they become Phase B's scoping selectors.

## Results

### Scenario 1 — Quote a text-only tweet, repost menu → Quote (2026-07-15)

Route: `https://x.com/compose/post` — same route as the plain modal, so
route alone cannot distinguish a quote composer.

Key JSON excerpts (full run in chat, 2026-07-14T23:09Z):

```json
{
  "legacyTweetTestidPresent": false,
  "previewCandidates": [
    {
      "anchor": "div[data-testid=\"attachments\"]",
      "testid": "attachments",
      "hasTweetText": true,
      "tweetTextLang": "en",
      "tweetTextSample": "please i'm begging you show me something you built…",
      "userNameSpans": ["dax", "dax", "@thdxr", "·"],
      "mediaImageUrls": [],
      "timeElement": true,
      "linksToStatus": false
    }
  ]
}
```

Findings:

1. **The quoted-tweet preview mounts inside `div[data-testid="attachments"]`**
   — the same container spike 18-A confirmed for image attachments. X treats
   the quoted tweet as an attachment. This is the single most consequential
   finding: §18's attachment discovery scans that container for `<img>`
   previews, so a quoted tweet **with images** may leak into attachment
   discovery (scenario 2/4 must confirm).
2. `legacyTweetTestidPresent: false` — confirms §20.1's diagnosis; the old
   `[data-testid="tweet"]` exclusion never fires on current markup.
3. Extraction anchors all readable inside the preview:
   `[data-testid="tweetText"]` with `lang` attr (→ `sourceLanguage`),
   `[data-testid="User-Name"]` spans (display name ×2, `@handle`, `·`),
   `time` element, `Tweet-User-Avatar`.
   Attachment discovery must explicitly exclude this avatar testid: its
   40×40 image otherwise passes the generic attachment-size threshold.
4. `linksToStatus: false` — the preview is not a status link; identity must
   come from content (text+handle fingerprint), not URL.
5. The probe reported **two near-identical dialogs** (one extra `mask`
   testid) — X nests `role="dialog"` wrappers. Existing composer detection
   already resolves via `editable.closest('[role="dialog"]')` (innermost),
   but Phase B must dedupe by editable, not by dialog count.

Working detection hypothesis (pending scenarios 2 & 5): quote composer =
modal standalone composer whose `[data-testid="attachments"]` subtree
contains `[data-testid="tweetText"]` or (`User-Name` + `time`) — a plain
image attachment has neither. Control run (scenario 5) must confirm a plain
modal lacks these; scenario 2 must show how quoted-tweet media URLs appear
so §18 discovery can exclude them.

**Latent §18 bug confirmed at code level:** `composerAttachments.ts`
discovery accepts `https` `<img>`s ≥40px inside `[data-testid="attachments"]`
(avatar/toolbar ancestors excluded — but a quoted tweet's *media* images have
neither ancestor). Since the quoted preview mounts inside that container, a
quoted tweet with images would today be discovered as the user's own
attachments: fetched, re-encoded, counted in "Read attached images (N)", and
sent as `attachedImages`. Phase B must exclude the quoted-preview subtree
from attachment discovery and route its media to `quotedPost.imageUrls`
instead. Scenario 2 (quote an image tweet) and scenario 4 (quote + own
attached image) decide the exact exclusion boundary.

### Scenario 4 — Quote (text-only tweet) + own attached image, empty composer (2026-07-15)

Same quoted tweet as scenario 1, with the user's own image attached and no
composer text. New testids appear for own media chrome: `addButton`,
`altTextLabel`, `altTextWrapper`, `tagPeopleLabel`,
`dual-phase-countdown-circle`.

Findings:

- The quoted preview stays fully readable (tweetText + User-Name + time)
  with own media in the same `attachments` container — detection is not
  disturbed by the user's own attachments.
- `mediaImageUrls` stays empty because the user's own preview is a `blob:`
  URL while the probe only reports `https://…twimg.com/media/…` — i.e. the
  scheme cleanly separates own attachments (blob) from quoted-tweet media
  (twimg https). Candidate exclusion rule for the §18 leak: within a quote
  composer, treat `https` images inside the quoted-preview subtree as
  quoted media, never as own attachments; own attachments remain the
  `blob:` previews.
- Also recorded: composer text + own images (same quoted tweet) — DOM
  findings identical; composer text lives in the textarea and does not
  affect detection.

### Scenario 2 — Quote a tweet with 4 images (2026-07-15)

Quoted @China_says (4 photos + caption). Key excerpts:

```json
{
  "allTestids": ["…", "tweetPhoto", "tweetText", "…"],
  "previewCandidates": [{
    "anchor": "div[data-testid=\"attachments\"]",
    "hasTweetText": true,
    "tweetTextLang": "en",
    "userNameSpans": ["China Says", "China Says", "@China_says", "·"],
    "mediaImageUrls": [
      "https://pbs.twimg.com/media/HLEFL4UbMAA852q?format=jpg&name=tiny",
      "https://pbs.twimg.com/media/HLEFMLwa8AAziwy?format=jpg&name=tiny",
      "https://pbs.twimg.com/media/HLEFMflaUAAB4f5?format=jpg&name=tiny",
      "https://pbs.twimg.com/media/HLEFMz9a4AAVa3L?format=jpg&name=tiny"
    ]
  }]
}
```

Findings:

- Quoted-tweet media renders as **https `pbs.twimg.com/media/...` images
  under `[data-testid="tweetPhoto"]` inside the preview** — confirming both
  the §18 leak (these would be discovered as own attachments today) and the
  `quotedPost.imageUrls` source. The preview serves the `name=tiny` variant;
  extraction should upgrade to a larger `name=` variant for the provider,
  the same way reply-image extraction handles X CDN URLs.
- `tweetPhoto` appears in the dialog only when the quoted tweet has media —
  own attachments never produce it.

### Locked Phase B anchors (from scenarios 1, 2, 4)

- **Quote detection predicate**: modal standalone composer whose
  `[data-testid="attachments"]` subtree contains `[data-testid="tweetText"]`
  or (`[data-testid="User-Name"]` and a `time` element). Pending scenario 5
  control confirmation that a plain modal never matches.
- **Attachment ownership boundary**: quoted primary media is under
  `tweetPhoto`, and every other quote-card asset is HTTPS; the user's own
  composer previews remain `blob:`/`data:`. In a quote composer, attachment
  discovery accepts local schemes (or a real File) and rejects remote HTTPS.
- **Extraction**: text = `[data-testid="tweetText"]` (+ `lang`); author =
  `[data-testid="User-Name"]` spans (display name, `@handle`); media =
  `[data-testid="tweetPhoto"] img` https URLs (upgrade `name=tiny`).
- Own attachments remain `blob:` previews — scheme alone also separates the
  two, used as a second guard.

### Scenario 5 — Plain `/compose/post` control (2026-07-15)

No `attachments` testid at all, no `tweetText`, no `User-Name`, no `time`,
`previewCandidates: []` in both nested dialogs. The detection predicate
cannot false-positive on a plain modal.

### Conclusion

Detection and extraction anchors locked as above; §20.4's hypothesis holds
across scenarios 1, 2, 4, and 5 (plus a text+images variant of 4). Phase B
proceeds with: intentional quote detection (dead `[data-testid="tweet"]`
exclusion removed), quoted-preview subtree excluded from §18 attachment
discovery, and quoted text/author/media/lang extraction from the recorded
anchors.
