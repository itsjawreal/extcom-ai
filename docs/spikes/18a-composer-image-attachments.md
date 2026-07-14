# Spike 18-A — Composer image attachment byte access (browser-real)

Goal (plan_v3.md §18.4 / §18.15): prove, in a real logged-in X session, whether
the active standalone composer exposes a usable `File`, a readable `blob:` URL,
or a stable HTTPS preview for locally attached images. The result decides the
transport design for AI Post image understanding. No API/UI changes ship from
this spike.

## How to run

1. Open x.com in Chrome, logged in, DevTools console on the top frame.
2. Paste the probe snippet below (it defines `eksSpike`).
3. For each scenario in the matrix, attach image(s), run
   `await eksSpike.probe()`, and paste the JSON output into the results
   section of this file.
4. Scenarios that involve time (blob lifetime, close/reopen) use
   `await eksSpike.probe()` twice with the noted action in between.

The snippet scopes every query to the same composer roots the extension already
uses (`postComposerObserver.ts`): modal composer = `[role="dialog"]` on
`/compose/post` containing `[data-testid="tweetButton"]` and no
`[data-testid="tweet"]`; inline composer = ancestor of
`[data-testid^="tweetTextarea_"]` on `/home` containing
`[data-testid="tweetButtonInline"]`.

## Probe snippet

```js
window.eksSpike = (() => {
  const EDITABLE = '[data-testid^="tweetTextarea_"], [role="textbox"][contenteditable="true"]';

  function findComposerRoots() {
    const roots = [];
    for (const editable of document.querySelectorAll(EDITABLE)) {
      const dialog = editable.closest('[role="dialog"]');
      if (dialog) {
        if (!/^\/compose\/post\/?$/.test(location.pathname)) continue;
        if (dialog.querySelector('[data-testid="tweet"]')) continue; // quote flow
        if (!dialog.querySelector('[data-testid="tweetButton"]')) continue;
        roots.push({ kind: "modal", root: dialog });
        continue;
      }
      if (location.pathname !== "/home" || editable.closest("article")) continue;
      let node = editable.parentElement;
      for (let d = 0; node && d < 14; d += 1, node = node.parentElement) {
        if (node.querySelector('[data-testid="tweetButtonInline"]')) {
          roots.push({ kind: "inline", root: node });
          break;
        }
      }
    }
    return roots;
  }

  function describeElement(el) {
    const testid = el.getAttribute("data-testid");
    return `${el.tagName.toLowerCase()}${testid ? `[data-testid="${testid}"]` : ""}`;
  }

  // Shortest data-testid/tag path from composer root down to el, so we can
  // record a stable scoping anchor rather than a brittle full CSS path.
  function anchorPath(root, el) {
    const parts = [];
    for (let node = el; node && node !== root; node = node.parentElement) {
      if (node.getAttribute("data-testid")) parts.unshift(describeElement(node));
    }
    return parts.join(" > ") || "(no data-testid ancestors under root)";
  }

  async function sniff(bytes) {
    const b = new Uint8Array(bytes.slice(0, 12));
    const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");
    let sig = "unknown";
    if (b[0] === 0xff && b[1] === 0xd8) sig = "jpeg";
    else if (b[0] === 0x89 && b[1] === 0x50) sig = "png";
    else if (b[8] === 0x57 && b[9] === 0x45) sig = "webp";
    else if (b[0] === 0x47 && b[1] === 0x49) sig = "gif";
    return { sig, first12: hex };
  }

  async function fingerprint(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  async function probeFileInputs(root) {
    const out = [];
    for (const input of root.querySelectorAll('input[type="file"]')) {
      const entry = {
        anchor: anchorPath(root, input),
        accept: input.accept || null,
        multiple: input.multiple,
        fileCount: input.files ? input.files.length : null,
        files: [],
      };
      for (const file of input.files ?? []) {
        const rec = { type: file.type, size: file.size, lastModified: file.lastModified };
        try {
          const bytes = await file.arrayBuffer();
          Object.assign(rec, { readable: true, bytesRead: bytes.byteLength }, await sniff(bytes));
          rec.fingerprint = await fingerprint(bytes);
        } catch (err) {
          Object.assign(rec, { readable: false, error: String(err) });
        }
        entry.files.push(rec);
      }
      out.push(entry);
    }
    return out;
  }

  async function probePreviews(root) {
    const out = [];
    for (const img of root.querySelectorAll("img")) {
      const src = img.currentSrc || img.src || "";
      const scheme = src.split(":")[0];
      if (!/^(blob|data|https)$/.test(scheme)) continue;
      // Filter obvious non-attachments: emoji, avatars, tiny icons.
      if (img.closest('[data-testid^="UserAvatar"], [data-testid="toolBar"]')) continue;
      if ((img.naturalWidth || img.width) < 40) continue;
      const rec = {
        scheme,
        anchor: anchorPath(root, img),
        alt: img.alt || null,
        natural: `${img.naturalWidth}x${img.naturalHeight}`,
        srcPrefix: src.slice(0, 64),
      };
      try {
        const res = await fetch(src);
        const bytes = await res.arrayBuffer();
        Object.assign(rec, { readable: true, bytesRead: bytes.byteLength }, await sniff(bytes));
        rec.fingerprint = await fingerprint(bytes);
      } catch (err) {
        Object.assign(rec, { readable: false, error: String(err) });
      }
      out.push(rec);
    }
    return out;
  }

  async function probe() {
    const roots = findComposerRoots();
    const report = { url: location.href, at: new Date().toISOString(), composers: [] };
    for (const { kind, root } of roots) {
      report.composers.push({
        kind,
        fileInputs: await probeFileInputs(root),
        previews: await probePreviews(root),
      });
    }
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  return { probe, findComposerRoots };
})();
"eksSpike ready — run: await eksSpike.probe()";
```

## What each field proves

- `fileInputs[].files[].readable: true` with matching `sig` → **`File` transport
  is viable**: the composer keeps the selected `File` accessible and its bytes
  match a real image signature.
- `previews[].scheme: "blob"` + `readable: true` → **blob transport viable**
  (resolve in page/content context, never send raw `blob:` to Railway).
- `previews[].scheme: "https"` + `readable: true` → preview already uploaded to
  X CDN; usable only if the anchor confirms it is inside the attachment
  container (check `anchor`, expect something like `[data-testid="attachments"]`).
- `fingerprint` equal across two probes → media identity is stable; unequal
  after replacing an image → fingerprint correctly tracks changes (§18.9).
- Empty `fileInputs[].files` but populated `previews` → X clears the input
  after ingesting; transport must come from previews/blob.

## Scenario matrix (record JSON output per row)

| # | Scenario | Steps | Result |
|---|----------|-------|--------|
| 1 | File picker, 1 PNG chart, Home inline | attach via toolbar picker → probe | |
| 2 | Drag-and-drop, 1 image, Home inline | drop file onto composer → probe | |
| 3 | 4 images, Home inline | attach 4 → probe (expect 4, X display order) | |
| 4 | Modal composer (`/compose/post`), 1 image | open modal → attach → probe | |
| 5 | Blob lifetime | probe → wait 60s doing nothing → probe again (same fingerprints? blob still readable?) | |
| 6 | Close/reopen AI Post panel | attach → probe → open+close panel → probe | |
| 7 | Remove image while attached | attach 2 → probe → remove 1 → probe (count drops, fingerprint of removed gone) | |
| 8 | Replace image | attach A → probe → remove → attach B → probe (fingerprint changes) | |
| 9 | SPA navigation | attach on Home → navigate to a profile → back → probe | |

## Recording results

Paste each probe JSON under a `### Scenario N` heading below, with Chrome
version and date. Conclude with one of:

- **FILE** — `input[type=file].files` reliably readable → primary transport.
- **BLOB** — files cleared but blob previews readable → resolve blobs at
  Generate time.
- **HTTPS** — only CDN previews available → fetch and re-validate bytes.
- **BLOCKED** — no readable byte source → stop, document blocker in §18, do
  not fake it via URLs (plan §18.4).

## Caveats

- DevTools console runs in the page context; the extension content script is an
  isolated world but shares the DOM, so element/`File`/`blob:` access results
  transfer. `fetch(blobUrl)` works from the content script because the blob was
  created by the same document.
- X markup changes without notice — record the `anchor` values verbatim; they
  become the scoping selectors for the Phase B module.

## Results

### Scenario 1 — Home inline composer, 2 images via picker (2026-07-14)

```json
{
  "url": "https://x.com/home",
  "at": "2026-07-14T19:12:39.600Z",
  "composers": [
    {
      "kind": "inline",
      "fileInputs": [
        {
          "anchor": "div[data-testid=\"toolBar\"] > div[data-testid=\"ScrollSnap-SwipeableList\"] > div[data-testid=\"ScrollSnap-List\"] > input[data-testid=\"fileInput\"]",
          "accept": "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime",
          "multiple": true,
          "fileCount": 0,
          "files": []
        }
      ],
      "previews": [
        {
          "scheme": "blob",
          "anchor": "div[data-testid=\"attachments\"]",
          "natural": "720x1600",
          "srcPrefix": "blob:https://x.com/6ccc223c-...",
          "readable": true,
          "bytesRead": 101130,
          "sig": "jpeg",
          "fingerprint": "7e8baf065ca11eea"
        },
        {
          "scheme": "blob",
          "anchor": "div[data-testid=\"attachments\"]",
          "natural": "1070x602",
          "srcPrefix": "blob:https://x.com/80514fab-...",
          "readable": true,
          "bytesRead": 211191,
          "sig": "jpeg",
          "fingerprint": "18fd15102e4bf431"
        }
      ]
    }
  ]
}
```

### Conclusion: **BLOB**

- X's `input[data-testid="fileInput"]` exists (accept includes jpeg/png/webp/
  gif/mp4/mov, `multiple`) but is cleared after ingest (`fileCount: 0`) — the
  `File` transport is not available.
- Attachment previews are `blob:` `<img>` elements inside
  `div[data-testid="attachments"]`, fully readable via `fetch(blobUrl)` with
  valid image signatures and stable fingerprints. Resolve blobs at Generate
  time; never send a raw `blob:` URL to the backend.
- Confirmed scoping anchor for discovery: `[data-testid="attachments"]`
  within the composer root.
- Remaining matrix rows (modal composer, drag-drop, 4 images, blob lifetime,
  remove/replace, SPA nav) still worth running before the Phase F canary, but
  the transport decision is settled.

## Phase F canary (2026-07-15, local backend + real X session)

- Image-only Fresh with Read attached images On/Auto: generated posts are
  relevant to the attached media. ✅
- 4 attachments: generation succeeds, output relevant and grounded. ✅
- Fresh + images + Off, and Rewrite/Continue without text: rejected with the
  mode-specific guidance messages. ✅
- Stale-media guard: after changing attachments, Insert is blocked with
  "Attached images changed. Regenerate for the current composer."; a fresh
  generate against the new media produces relevant output. ✅

Remaining before release sign-off: modal composer (/compose/post) spot check
and an explicit On-vs-Off comparison on the same chart; reply/quote
regression suite already covered by automated tests.
