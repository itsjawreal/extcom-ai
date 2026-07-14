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

(pending)
