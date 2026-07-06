# PLAN.md — X/Twitter AI Comment Copilot Extension

## 0. Product Goal

Build a browser extension that adds an **AI Reply** button/panel inside X/Twitter posts.

User flow:

1. User opens a post on X/Twitter.
2. Extension shows an **AI Reply** button near the post actions.
3. User clicks **AI Reply**.
4. Extension reads the visible post text and optional thread context.
5. Extension sends the context to our backend.
6. Backend generates several reply options using an AI provider.
7. User selects or edits one reply.
8. Extension inserts the selected reply into the reply box.
9. User manually clicks **Post/Reply**.

Important: this is a **human-in-the-loop comment copilot**, not an auto-reply bot.

---

## 1. Non-Negotiable Rules

### Allowed

- Generate reply drafts.
- Insert selected draft into the reply composer.
- Let the user edit the reply.
- Let the user manually publish the reply.
- Limit generations per user based on subscription tier.
- Support multiple tones/personas.
- Support X/Twitter web only for MVP.

### Not Allowed

- Do not auto-click the final Post/Reply button.
- Do not mass-reply to many posts automatically.
- Do not scrape timelines at scale.
- Do not run background auto-commenting.
- Do not steal or use ChatGPT/Claude web session cookies.
- Do not ask users for their OpenAI/Claude API keys in MVP.
- Do not store unnecessary tweet/user data.

---

## 2. MVP Scope

### MVP Features

- Chrome Extension Manifest V3.
- Inject **AI Reply** button into X/Twitter post UI.
- Open small floating panel near the post.
- Extract:
  - post text
  - author handle if visible
  - current URL
  - optional parent/thread text if visible
- Tone selector:
  - Degen
  - Bullish
  - Smart Money
  - Funny
  - Respectful
  - Short Alpha
- Generate 3 reply options.
- User can regenerate.
- User can copy reply.
- User can insert reply into X reply box.
- Basic login token stored in extension.
- Backend endpoint for AI generation.
- Rate limit per user.
- Subscription gate placeholder.

### Out of Scope for MVP

- Auto-posting.
- Mobile extension.
- Firefox support.
- Team accounts.
- Analytics dashboard.
- Full CRM.
- Multi-account automation.
- Complex timeline scanning.
- Image/chart analysis.
- Voice/personality training from user history.

---

## 3. Recommended Tech Stack

### Browser Extension

- TypeScript
- Vite
- Chrome Extension Manifest V3
- React for popup/side panel
- Plain content script for DOM injection
- `chrome.storage.local` for auth/session settings
- `chrome.runtime.sendMessage` for extension messaging

### Backend

Use one of these:

Option A:

- Node.js
- Express or Fastify
- PostgreSQL
- Redis for rate limits
- Stripe or Lemon Squeezy for subscriptions

Option B:

- Next.js API routes
- PostgreSQL/Supabase
- Upstash Redis
- Stripe or Lemon Squeezy

### AI Providers

Backend only. Never expose provider API keys in the extension.

- OpenAI API
- Anthropic API
- Optional provider router:
  - default model
  - fallback model
  - cheaper model for low tiers
  - premium model for paid tiers

---

## 4. High-Level Architecture

```txt
Chrome Extension
  ├─ content script
  │   ├─ watches X/Twitter DOM
  │   ├─ injects AI Reply buttons
  │   ├─ extracts post context
  │   └─ inserts chosen reply into composer
  │
  ├─ popup / side panel
  │   ├─ login status
  │   ├─ usage count
  │   ├─ tone defaults
  │   └─ subscription status
  │
  └─ background service worker
      ├─ handles auth token
      ├─ calls backend
      └─ coordinates messages

Backend
  ├─ auth
  ├─ subscription status
  ├─ rate limiting
  ├─ AI generation endpoint
  ├─ prompt engine
  ├─ safety filters
  └─ usage logging
```

---

## 5. Folder Structure

```txt
ai-reply-extension/
  apps/
    extension/
      public/
      src/
        background/
          serviceWorker.ts
        content/
          injectButton.ts
          extractPost.ts
          observeTimeline.ts
          replyComposer.ts
          panel.tsx
          styles.css
        popup/
          Popup.tsx
          popup.html
          popup.tsx
        shared/
          apiClient.ts
          types.ts
          constants.ts
      manifest.json
      package.json
      vite.config.ts

    backend/
      src/
        server.ts
        routes/
          auth.ts
          generateReply.ts
          subscription.ts
          health.ts
        services/
          aiProvider.ts
          promptBuilder.ts
          rateLimit.ts
          safety.ts
          usage.ts
        db/
          schema.sql
          client.ts
        middleware/
          requireAuth.ts
          errorHandler.ts
        types/
          index.ts
      package.json
      .env.example

  docs/
    PLAN.md
    API.md
    PROMPTS.md

  package.json
  README.md
```

---

## 6. Extension Permissions

Start minimal.

```json
{
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": [
    "https://x.com/*",
    "https://twitter.com/*",
    "https://api.yourdomain.com/*"
  ]
}
```

Avoid broad permissions unless needed.

---

## 7. Core Extension Tasks

### 7.1 Detect X/Twitter Posts

Create a DOM observer that watches timeline/post containers.

Requirements:

- Works on home timeline.
- Works on individual post page.
- Avoid duplicate buttons.
- Survives X/Twitter client-side navigation.
- Re-injects after DOM changes.

Implementation hints:

- Use `MutationObserver`.
- Mark processed post nodes with `data-ai-reply-processed="true"`.
- Use defensive selectors because X changes DOM often.
- Prefer text-based extraction from visible elements.

---

### 7.2 Inject AI Reply Button

For each detected post:

- Add button near reply/repost/like area.
- Label: `AI Reply`.
- Keep styling minimal and native-looking.
- On click, open floating panel.

Button behavior:

```txt
Click AI Reply
  ↓
Extract post context
  ↓
Open panel with loading state
  ↓
Call backend
  ↓
Render 3 generated replies
```

---

### 7.3 Extract Post Context

Return this shape:

```ts
type ExtractedPostContext = {
  postText: string;
  authorHandle?: string;
  authorName?: string;
  postUrl?: string;
  visibleThreadText?: string[];
  timestampText?: string;
};
```

Rules:

- Do not collect unnecessary private data.
- Do not scan the whole timeline.
- Only use visible content around the clicked post.
- If extraction fails, show a helpful error.

---

### 7.4 Floating Reply Panel

Panel states:

```txt
Idle
Loading
Success
Error
```

Panel content:

- Tone selector
- Generate button
- 3 reply options
- Copy button for each option
- Insert button for each option
- Regenerate button
- Optional manual instruction box

Example UI:

```txt
AI Reply

Tone:
[Degen] [Bullish] [Smart] [Funny] [Respectful]

Replies:
1. "ngl this setup feels like CT is still sleeping on it"
   [Copy] [Insert]

2. "clean narrative, clean timing. this can get interesting fast"
   [Copy] [Insert]

3. "early attention + strong meme energy is always a dangerous combo"
   [Copy] [Insert]

[Regenerate]
```

---

### 7.5 Insert Into Reply Box

Safe behavior:

1. Trigger X reply composer.
2. Focus text area/contenteditable field.
3. Insert selected reply text.
4. Do not click final Post/Reply button.

Implementation hints:

- X uses React and contenteditable fields.
- Use `InputEvent` after setting text.
- Prefer simulating paste/input rather than directly mutating DOM only.
- Always leave final publish action to the user.

---

## 8. Backend API Contract

### 8.1 Health Check

```http
GET /health
```

Response:

```json
{
  "ok": true
}
```

---

### 8.2 Generate Reply

```http
POST /v1/generate-reply
Authorization: Bearer <user_token>
Content-Type: application/json
```

Request:

```json
{
  "postText": "string",
  "authorHandle": "string",
  "authorName": "string",
  "postUrl": "string",
  "visibleThreadText": ["string"],
  "tone": "degen | bullish | smart | funny | respectful | short_alpha",
  "extraInstruction": "string",
  "count": 3
}
```

Response:

```json
{
  "replies": [
    {
      "id": "reply_1",
      "text": "string",
      "tone": "bullish"
    }
  ],
  "usage": {
    "remainingToday": 42,
    "plan": "pro"
  }
}
```

Errors:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Daily generation limit reached."
  }
}
```

---

## 9. Prompt Engine

### 9.1 System Prompt

```txt
You are an expert social reply assistant for X/Twitter.

Your task is to generate short, natural, human-sounding replies to a post.

Rules:
- Do not sound like a bot.
- Do not use hashtags unless requested.
- Do not overuse emojis.
- Do not make financial guarantees.
- Do not claim insider information.
- Do not harass, threaten, or target protected groups.
- Do not produce spammy or repetitive replies.
- Keep each reply under 220 characters unless requested.
- Match the selected tone.
- Make the reply relevant to the original post.
- Output only valid JSON.
```

### 9.2 User Prompt Template

```txt
Original post:
{{postText}}

Author:
{{authorName}} {{authorHandle}}

Visible thread context:
{{visibleThreadText}}

Selected tone:
{{tone}}

Extra user instruction:
{{extraInstruction}}

Generate {{count}} different replies.

Return JSON:
{
  "replies": [
    {
      "text": "..."
    }
  ]
}
```

---

## 10. Tone Definitions

### Degen

- Casual
- Crypto-native
- Short
- Timeline-friendly
- Can use slang lightly
- No cringe overhype

Example style:

```txt
ngl this is the kind of setup CT ignores until it is already everywhere
```

### Bullish

- Positive
- Confident
- Not making guarantees
- Good for token/narrative posts

Example style:

```txt
the narrative is clean and the timing looks better than people think
```

### Smart Money

- Analytical
- Calm
- Signal-focused
- No excessive hype

Example style:

```txt
attention is still early here, that is usually where the best asymmetry shows up
```

### Funny

- Light humor
- Not offensive
- Short

Example style:

```txt
timeline is about to pretend they saw this coming
```

### Respectful

- Polite
- Good for creators/KOLs
- Adds value without clout-chasing

Example style:

```txt
solid take. the part about timing is probably what most people are missing
```

### Short Alpha

- Very concise
- Insight-like
- No filler

Example style:

```txt
attention before consensus is the edge
```

---

## 11. Safety Layer

Before sending final replies to the extension:

- Reject threats or harassment.
- Reject protected-class attacks.
- Reject doxxing.
- Reject explicit financial guarantees.
- Reject impersonation.
- Reject spammy repeated replies.
- Reject requests to auto-post.
- Remove excessive emojis/hashtags.
- Avoid statements like:
  - “guaranteed 100x”
  - “insider info”
  - “risk-free”
  - “everyone must buy”
  - “go harass this person”

Crypto-specific rule:

- Replies can be bullish, but must not guarantee returns.

---

## 12. Database Schema

Minimal tables:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  plan TEXT DEFAULT 'free',
  subscription_status TEXT DEFAULT 'inactive'
);

CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE generated_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  post_url TEXT,
  tone TEXT,
  reply_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

Privacy note:

- Consider not storing raw post text by default.
- Store only generated reply + usage metadata unless debugging is enabled.

---

## 13. Rate Limits

Suggested tiers:

```txt
Free:
- 20 generations/day
- 3 replies per generation
- basic tones only

Pro:
- 300 generations/day
- all tones
- custom instruction
- priority model

Power:
- 1000 generations/day
- faster model routing
- saved personas
```

Rate limit keys:

```txt
rate:user:{userId}:daily
rate:user:{userId}:minute
```

Suggested limits:

```txt
Free:
- 5 requests/minute
- 20 requests/day

Pro:
- 30 requests/minute
- 300 requests/day

Power:
- 60 requests/minute
- 1000 requests/day
```

---

## 14. Auth

MVP options:

### Option A: Magic Link

- User logs in on website.
- Backend creates session token.
- Extension receives token via redirect/deep link/manual copy.

### Option B: Extension Login Code

- Extension shows login code.
- User logs into website.
- User enters code.
- Backend links extension session.

### Option C: Email + Password

- Simple but more security responsibility.

Recommended MVP:

- Use hosted auth provider:
  - Clerk
  - Supabase Auth
  - Auth.js
  - Firebase Auth

---

## 15. Subscription

Use Stripe or Lemon Squeezy.

Backend should expose:

```http
GET /v1/me/subscription
Authorization: Bearer <user_token>
```

Response:

```json
{
  "plan": "free | pro | power",
  "status": "active | inactive | past_due",
  "limits": {
    "dailyGenerations": 300,
    "remainingToday": 212
  }
}
```

---

## 16. Environment Variables

Backend `.env.example`:

```txt
PORT=3000
DATABASE_URL=
REDIS_URL=
JWT_SECRET=

OPENAI_API_KEY=
ANTHROPIC_API_KEY=

AI_DEFAULT_PROVIDER=openai
AI_DEFAULT_MODEL=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

APP_URL=https://yourdomain.com
EXTENSION_ORIGIN=chrome-extension://replace-me
```

---

## 17. Implementation Milestones

### Milestone 1 — Static Extension Prototype

Goal: prove UI injection works.

Tasks:

- Create MV3 extension.
- Load extension in Chrome.
- Run content script on `x.com`.
- Detect post containers.
- Inject `AI Reply` button.
- Show panel with fake replies.
- Copy fake reply to clipboard.

Done when:

- Button appears on multiple posts.
- No duplicate buttons.
- Panel opens reliably.

---

### Milestone 2 — Context Extraction

Goal: extract post text reliably.

Tasks:

- Implement `extractPost.ts`.
- Extract post text.
- Extract author handle if visible.
- Extract URL if available.
- Add debug panel showing extracted context.
- Handle individual post page and timeline posts.

Done when:

- Clicking button returns correct post text for most visible posts.

---

### Milestone 3 — Backend Generation Endpoint

Goal: generate AI replies from backend.

Tasks:

- Create backend server.
- Add `/health`.
- Add `/v1/generate-reply`.
- Add prompt builder.
- Add AI provider wrapper.
- Return 3 replies.
- Add basic error handling.

Done when:

- Extension can call backend and show generated replies.

---

### Milestone 4 — Insert Into Reply Composer

Goal: let user insert selected reply.

Tasks:

- Find reply button for selected post.
- Open reply composer.
- Focus composer text field.
- Insert reply.
- Dispatch input event.
- Do not auto-submit.

Done when:

- Selected reply appears in composer and user can manually post.

---

### Milestone 5 — Auth + Usage Limits

Goal: prevent public abuse.

Tasks:

- Add login.
- Store auth token in extension.
- Add `requireAuth` middleware.
- Add user table.
- Add usage event table.
- Add daily usage counter.
- Show remaining usage in popup/panel.

Done when:

- Anonymous users cannot generate.
- Logged-in users have rate limits.

---

### Milestone 6 — Subscription Gate

Goal: monetize.

Tasks:

- Add Stripe/Lemon Squeezy checkout.
- Add webhook handler.
- Update user plan/status.
- Enforce plan-based rate limits.
- Show upgrade CTA.

Done when:

- Paid users get higher limits.
- Free users hit upgrade state after daily limit.

---

### Milestone 7 — Polish + Beta

Goal: usable beta.

Tasks:

- Improve UI.
- Add loading skeleton.
- Add retry/regenerate.
- Add error messages.
- Add tone default setting.
- Add privacy notice.
- Add feedback button.
- Add basic logging.
- Test with 10–20 beta users.

Done when:

- Product is stable enough for private beta.

---

## 18. Testing Checklist

### Extension

- Button appears on home timeline.
- Button appears on post detail page.
- Button appears after scrolling.
- Button appears after client-side navigation.
- No duplicate buttons.
- Panel opens and closes.
- Reply generation loading state works.
- Errors are shown clearly.
- Copy button works.
- Insert button opens composer.
- Insert button fills composer.
- Extension never clicks final Post/Reply.

### Backend

- `/health` returns ok.
- Auth blocks unauthenticated requests.
- AI endpoint validates input.
- AI endpoint handles provider errors.
- Rate limit works.
- Usage count decreases.
- Subscription plan changes limits.
- Logs do not store unnecessary private data.

### Safety

- No auto-posting.
- No mass-commenting.
- No hidden background reply generation.
- No ChatGPT/Claude session scraping.
- No provider API key in extension bundle.
- No financial guarantee language encouraged by prompt.

---

## 19. Main Risks

### X/Twitter DOM Changes

Risk:

- Selectors break often.

Mitigation:

- Use flexible detection.
- Keep extraction defensive.
- Add debug mode.
- Avoid depending on fragile class names.

### Policy/Spam Risk

Risk:

- Product could be used for spam.

Mitigation:

- Human final click.
- Rate limits.
- No queue automation.
- Safety filters.
- No identical replies.
- No auto-posting.

### API Cost

Risk:

- Users can generate too much.

Mitigation:

- Strict rate limits.
- Daily quotas.
- Cheaper model for free plan.
- Cache/regenerate limits.
- Token cap.

### Low-Quality Replies

Risk:

- Replies sound generic or botted.

Mitigation:

- Tone-specific prompts.
- Keep replies short.
- Generate multiple options.
- Let user edit.
- Add user custom persona later.

---

## 20. Initial Development Order for Codex

Follow this order:

1. Scaffold monorepo.
2. Build extension with fake AI replies.
3. Implement X DOM observer.
4. Inject AI Reply button.
5. Build floating panel.
6. Extract post text.
7. Implement backend `/health`.
8. Implement backend `/v1/generate-reply`.
9. Connect extension to backend.
10. Insert generated reply into composer.
11. Add auth placeholder.
12. Add rate limit placeholder.
13. Add production auth.
14. Add subscription.
15. Polish and test.

---

## 21. Codex Task Prompt

Use this prompt with Codex inside VS Code:

```txt
You are building the MVP described in PLAN.md.

Start by creating a Chrome Extension Manifest V3 project inside apps/extension using TypeScript and Vite.

Implement:
1. manifest.json
2. background service worker
3. content script that runs on x.com and twitter.com
4. MutationObserver that detects visible posts
5. AI Reply button injection
6. Floating panel with fake generated replies
7. Copy button
8. Insert button placeholder

Do not implement auto-posting.
Do not click the final X/Twitter Post/Reply button.
Keep the code modular and readable.
Use defensive DOM selectors.
Add comments where X/Twitter DOM logic is fragile.
```

---

## 22. Definition of Done for MVP

The MVP is done when:

- User installs extension manually.
- User opens X/Twitter.
- User sees **AI Reply** button on posts.
- User clicks the button.
- Extension extracts post context.
- Backend generates 3 replies.
- User chooses a reply.
- Extension inserts the reply into composer.
- User manually posts the reply.
- Free/pro usage limits work.
- No provider API key is exposed client-side.
- No auto-posting exists anywhere in the codebase.
