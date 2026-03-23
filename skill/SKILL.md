---
name: instagram-unfollowers
description: Scan and clean Instagram following list — find accounts that don't follow back, verify each one via Instagram's API, and batch-unfollow with user approval. Use when asked to clean Instagram followers, find non-followers, unfollow people who don't follow back, or do an Instagram following audit. Requires the user's Chrome with an active Instagram session. Also supports offline analysis from Instagram data export JSONs (followers_1.json + following.json).
---

# Instagram Unfollowers

Audit and clean an Instagram following list by finding accounts that don't follow back, verifying via Instagram's live API, and batch-unfollowing with explicit user approval.

## Key Learnings (from production use 2026-03-23)

- **Use OpenClaw browser** (no `profile`), NOT `profile=user`. The user profile asks for "Allow" every time. Instead, have the user log into Instagram in the OpenClaw-managed Chrome once.
- **Max 3 unfollows per evaluate call** — 4+ with 2s delays causes browser tool timeout.
- **Max 10 API calls per evaluate call** for scanning — keeps under timeout.
- **Include `is_verified` in verification** — let the user skip verified accounts (celebrities, brands) automatically.
- **Show full_name alongside username** — users can't decide from usernames alone.
- **Maintain a whitelist file** (`instagram-whitelist.md`) with tags (outfits, influencer, marca, música, etc.) for accounts the user wants to keep.
- **Gateway restarts kill scan state** — store scan progress in `window.__IG_SCAN` but be ready to re-scan (~2 min for ~2200 following).

## CLI Tool

This skill is also available as a standalone CLI: [`insta-unfollow-cli`](https://github.com/gonzalopezgil/insta-unfollow-cli)

```bash
npx insta-unfollow-cli login       # Save cookies
npx insta-unfollow-cli scan        # Scan following list
npx insta-unfollow-cli check       # Verify non-followers
npx insta-unfollow-cli unfollow    # Interactive unfollow
npx insta-unfollow-cli offline <followers.json> <following.json>
npx insta-unfollow-cli stats       # Account summary
```

## Two Modes

### Mode 1: Offline Analysis (from Instagram data export)
Use when the user provides `followers_1.json` and `following.json` from Instagram's data export (Settings → Your Activity → Download Your Information).

1. Parse both JSON files
2. Extract usernames: `followers_1[].string_list_data[0].value` and `following.relationships_following[].title`
3. Compute `following - followers` = accounts not following back
4. Filter out celebrities, brands, orgs, media (see `references/non-personal-filters.md`)
5. Output a clean text file with personal accounts only

### Mode 2: Live Scan + Unfollow (via browser)
Use when the user wants real-time verification and actual unfollowing.

#### Prerequisites
- OpenClaw-managed Chrome (no `profile` param) with active Instagram session at instagram.com
- Do NOT use `profile=user` — it prompts the user for "Allow" on every action
- Have the user log into Instagram in the OpenClaw browser once: `browser action=open url=https://instagram.com`

#### Step 1: Scan Following List
Query Instagram's GraphQL API to get all accounts the user follows, including `follows_viewer` field:

```javascript
// Initialize scan state
const ds_user_id = document.cookie.split('; ').find(c => c.startsWith('ds_user_id=')).split('=')[1];
window.__IG_SCAN = { userId: ds_user_id, results: [], hasNext: true, cursor: null, total: -1 };
```

Fetch in batches of 10 requests per evaluate call (to avoid browser tool timeout):

```javascript
// Repeat until hasNext === false
const vars = cursor
  ? `{"id":"${userId}","include_reel":"true","fetch_mutual":"false","first":"24","after":"${cursor}"}`
  : `{"id":"${userId}","include_reel":"true","fetch_mutual":"false","first":"24"}`;
const url = `https://www.instagram.com/graphql/query/?query_hash=3dec7e2c57367ef3da3d987d89f9dbc8&variables=${vars}`;
// Parse response: json.data.user.edge_follow
// Store: edges[].node.{id, username, follows_viewer}
// Sleep 1000-1200ms between requests
```

#### Step 2: Extract Non-Followers
Filter results where `follows_viewer === false`.

#### Step 3: Verify Each Batch (MANDATORY)
Before presenting any batch to user, verify each account via the profile API:

```javascript
const r = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
  headers: { 'x-ig-app-id': '936619743392459' }
});
const j = await r.json();
const p = j.data.user;
// Check: p exists (account active)
// Check: p.followed_by_viewer === true (we follow them)
// Check: p.follows_viewer === false (they don't follow us)
// Extract: p.full_name (show to user alongside username)
// Extract: p.is_verified (auto-skip verified accounts if user requests)
```

Sleep 1500ms between verifications. Max 10 verifications per evaluate call.

#### Step 4: Present Batches of 10
Show verified results 10 at a time in a table with full name:

```
| # | Usuario | Nombre | Verificado |
|---|---------|--------|------------|
| 1 | @user   | Nombre Real | ❌ |
```

If user asked to skip verified accounts, auto-exclude them and note how many were skipped.

Wait for user to specify which to unfollow. User may say things like:
- "quita todos" → unfollow all 10
- "quita todos menos 3 y 7" → keep 3 and 7, unfollow rest
- "quita 1,2,5,8" → unfollow those specific ones
- "el 4 ya lo hice yo" → skip 4

#### Step 5: Execute Unfollows
Unfollow confirmed accounts using the friendships API:

```javascript
const csrftoken = document.cookie.split('; ').find(c => c.startsWith('csrftoken=')).split('=')[1];
await fetch(`https://www.instagram.com/web/friendships/${userId}/unfollow/`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    'x-csrftoken': csrftoken
  },
  credentials: 'include'
});
```

**Rate limiting (critical):**
- 2-3 seconds between unfollows
- **Max 3 unfollows per evaluate call** (4+ causes browser tool timeout)
- Split 9 unfollows into 3 calls of 3
- Pause 5 minutes after every 15-20 unfollows to avoid Instagram temp blocks

#### Step 6: Verify Unfollows Worked
After each batch of unfollows, verify via profile API that `followed_by_viewer === false`.

#### Step 7: Next Batch
Continue with next 10 until user says stop.

## Important Notes

- **NEVER unfollow without explicit user approval** for each batch
- **ALWAYS verify** each account exists and follow state before presenting
- All API calls go to instagram.com only — zero external servers
- All data stays local — nothing leaves the browser
- The GraphQL query_hash `3dec7e2c57367ef3da3d987d89f9dbc8` is Instagram's public following endpoint
- The `x-ig-app-id: 936619743392459` is Instagram's web app ID (public, not a secret)
- CSP blocks script injection via `<script>` tags — use `evaluate` via browser tool instead
- Keep evaluate calls short (10 API calls max for reads, 3 max for unfollows) to avoid browser tool timeouts
- **Maintain a whitelist file** at `instagram-whitelist.md` in agent workspace — log accounts the user wants to keep with tags (outfits, influencer, marca, música, ONG, etc.)
- When user says "deja X" or "mantén X", add to whitelist with the tag they give

## Security Audit Trail

Based on review of [davidarroyo1234/InstagramUnfollowers](https://github.com/davidarroyo1234/InstagramUnfollowers):
- ✅ All requests go only to instagram.com endpoints
- ✅ No external servers, no data exfiltration
- ✅ Uses existing session cookies (ds_user_id, csrftoken)
- ✅ Whitelist stored in localStorage only
- ✅ MIT licensed, open source, auditable
