# Privacy Policy — Extcom AI Reply

Effective date: 2026-07-13

Extcom AI Reply is a self-hosted browser extension. There is no company
server, no account system, and no telemetry. This page describes exactly
what data the extension touches and where it goes.

## What the extension does

Extcom AI Reply adds "AI Reply" to posts and "AI Post" to X/Twitter's
standalone composer. When you click AI Reply, the extension reads the visible content of that specific post
(and, where detected, its immediate reply-chain context) and sends it to a
backend server that you deploy and control, along with the generation
settings you've chosen (tone, reply length, and similar). That backend
calls an AI provider (OpenRouter or OpenAI) using an API key you supply,
and returns draft replies. When you click AI Post, the brief you type and
any existing text in that composer are sent through the same self-hosted
backend to generate standalone post drafts. You review and manually insert
every draft — the extension never clicks X's final Reply/Post button.

## Data the extension reads

- The text, author, image URLs, and immediate reply-chain context of the
  specific post you click "AI Reply" on. This only happens when you click
  the button — the extension does not scan your timeline in the
  background.
- The brief entered in the AI Post panel and existing text in that specific
  standalone composer, only after you click AI Post and request generation.
- Nothing outside the currently active X/Twitter tab. The extension has no
  access to any other tab, any other website, your browsing history, or
  your X/Twitter login credentials.

## Data the extension stores

Stored locally in your browser (`chrome.storage.local`), never sent
anywhere except where you explicitly configure:

- Your settings: backend URL, access token, default tone, draft count,
  reply length, and similar preferences.
- A local history of your own generations and inserted drafts, used only
  to show your own usage stats inside the extension popup.

This data stays on your device. Uninstalling the extension deletes it.

## Where post content and settings are sent

Exactly one destination: the backend URL you enter in Settings →
Advanced. This is a server you deploy yourself (see the project's
[README](../README.md) for deployment instructions) — the developer of
this extension does not operate, receive data from, or have access to
that server. No data is sent to the developer, to any analytics service,
or to any third party by the extension itself.

Your access token identifies you to your own backend for its own
rate-limiting. It is not an AI provider key and grants no access to any AI
provider account.

## Third parties

The backend you deploy sends post content to an AI provider (OpenRouter or
OpenAI, whichever you configure) using your own API key, subject to that
provider's own privacy policy. The extension itself has no direct
connection to any AI provider.

## What this extension does not do

- No account creation, login, or signup, anywhere in the extension.
- No telemetry, analytics, or crash reporting.
- No auto-posting. Every reply or standalone post requires you to review the
  draft and press Post yourself.
- No background scraping of your timeline, DMs, or any content you have
  not explicitly selected through AI Reply or AI Post.
- No selling or sharing of data — the extension developer never receives
  any data to sell or share.

## Changes to this policy

This is an open-source project. Changes to data handling are visible in
the project's public commit history and source code. Material changes to
this policy will be reflected here with an updated effective date.

## Source and contact

Source code: <https://github.com/itsjawreal/extcom-ai>
Issues/contact: <https://github.com/itsjawreal/extcom-ai/issues>
