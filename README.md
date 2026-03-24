# insta-unfollow-cli

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

Find Instagram accounts that don't follow you back and unfollow them — from your terminal.

Uses Instagram's internal GraphQL API directly. No scraping, no browser automation, no Selenium, no Puppeteer. Just clean API calls with your existing session cookies.

## Why This Exists

Browser extensions like [InstagramUnfollowers](https://github.com/davidarroyo1234/InstagramUnfollowers) work great — until Instagram's Content Security Policy (CSP) blocks script injection. CSP headers change frequently, breaking extensions without warning.

This CLI bypasses that entirely. It makes the same API calls Instagram's own web app makes, but from Node.js. No browser needed, no CSP issues, no extension permissions to worry about.

### vs. InstagramUnfollowers (browser extension)

| Feature | InstagramUnfollowers | insta-unfollow-cli |
|---------|---------------------|--------------------|
| Works when CSP blocks extensions | ❌ | ✅ |
| Runs without a browser | ❌ | ✅ |
| Scriptable / automatable | ❌ | ✅ (`--json`) |
| Offline analysis (data export) | ❌ | ✅ |
| Rate limiting built-in | Basic | Advanced (burst pauses) |
| Verification before unfollow | ❌ | ✅ (double-checks each) |
| Open source & auditable | ✅ | ✅ |
| AI agent integration (OpenClaw) | ❌ | ✅ |

## Installation

```bash
# Install globally
npm install -g insta-unfollow-cli

# Or use directly with npx
npx insta-unfollow-cli
```

**Requirements:** Node.js 18+ (uses native `fetch`)

## Quick Start

```bash
# 1. Save your Instagram cookies
insta-unfollow login

# 2. Scan your following list
insta-unfollow scan

# 3. Check who doesn't follow you back
insta-unfollow check --skip-verified

# 4. Generate a Markdown report with profile links to review
insta-unfollow report

# 5. Unfollow them (interactive, 10 at a time)
insta-unfollow unfollow --batch 10
```

## Commands

### `login` — Save Credentials

Saves your Instagram session cookies for subsequent commands.

```bash
# Interactive — prompts for each cookie value
insta-unfollow login

# From a cookie string
insta-unfollow login --cookies "ds_user_id=123; csrftoken=abc; sessionid=xyz"
```

**How to get your cookies:**
1. Open Chrome → go to [instagram.com](https://instagram.com) (make sure you're logged in)
2. Press `F12` → **Application** tab → **Cookies** → `https://www.instagram.com`
3. Copy the values for: `ds_user_id`, `csrftoken`, `sessionid`

```
  To get your Instagram cookies:
  1. Open Chrome → go to instagram.com (make sure you're logged in)
  2. Press F12 → Application tab → Cookies → https://www.instagram.com
  3. Copy the values for: ds_user_id, csrftoken, sessionid

  ds_user_id: 12345678
  csrftoken:  AbCdEfGhIjKl...
  sessionid:  12345678%3AMnOpQr...

  ✓ Logged in as @yourusername
  ✓ Credentials saved to ~/.insta-unfollow/auth.json
```

### `scan` — Scan Following List

Fetches everyone you follow via Instagram's GraphQL API, including whether they follow you back.

```bash
insta-unfollow scan

# Save to a custom file
insta-unfollow scan --output ./my-scan.json
```

```
  ⠋ Scanning following list... 1248/2200

  Scan Results
  ────────────────────────────────────
  Following:          2200
  Follow you back:    1650
  Don't follow back:  550
  Verified accounts:  89

  ✓ Full results saved to ~/.insta-unfollow/scan-results.json
```

### `check` — Verify Non-Followers

Double-checks each non-follower via Instagram's profile API in real-time. This catches stale data from the scan (e.g., someone followed you between scan and check).

```bash
# Verify all non-followers
insta-unfollow check

# Skip verified accounts (celebrities, brands)
insta-unfollow check --skip-verified
```

```
  Found 550 potential non-followers from scan.
  Verifying each one via Instagram API...

  ✓ Verification complete

  ⚠ Skipped 89 verified accounts
  Skipped 12 deleted/suspended accounts

  Confirmed non-followers: 423

    #   Username                  Full Name                      Verified
    ─────────────────────────────────────────────────────────────────────────
    1   @someuser                 Some Person                    —
    2   @another.user             Another Name                   —
    3   @brand_account            Brand Name                     ✓ Verified
  ...

  Run `insta-unfollow unfollow` to remove them.
```

### `unfollow` — Interactive Unfollow

Presents non-followers in batches for your approval before unfollowing.

```bash
# Default: batches of 10, interactive
insta-unfollow unfollow

# Custom batch size
insta-unfollow unfollow --batch 5

# Skip verified accounts
insta-unfollow unfollow --skip-verified

# See what would happen without doing it
insta-unfollow unfollow --dry-run

# Non-interactive (⚠️ use with caution)
insta-unfollow unfollow --no-interactive
```

```
  Batch 1 (10 accounts):
    #   Username                  Full Name                      Verified
    ─────────────────────────────────────────────────────────────────────────
    1   @someuser                 Some Person                    —
    2   @random.page              Random Page                    —
   ...

  Unfollow all in this batch? (y/n/quit): y
  ✓ Unfollowed @someuser
  ✓ Unfollowed @random.page
  ...

  Done! Unfollowed 10 accounts.
```

### `offline` — Offline Analysis

Analyze your Instagram data export without any API calls. No login needed.

```bash
insta-unfollow offline followers_1.json following.json
```

**How to get your data export:**
1. Instagram → Settings → Your Activity → Download Your Information
2. Select JSON format
3. Download and extract
4. Find `followers_1.json` and `following.json` in the `followers_and_following` folder

```
  Offline Analysis
  ────────────────────────────────────
  Followers:              1650
  Following:              2200
  Don't follow back:      550

  Accounts not following you back (550):
  ────────────────────────────────────
     1  @someuser
     2  @another.user
  ...

  Mutual followers: 1650
  Follow-back ratio: 75.0%
```

### `report` — Markdown Report with Profile Links

Generate a Markdown file listing all non-followers with clickable links to their Instagram profiles. Perfect for reviewing who each person is before deciding to unfollow.

```bash
# Generate report from last scan (fast — no API calls)
insta-unfollow report

# Verify each account via API first (slower but catches stale data)
insta-unfollow report --verify

# Skip verified accounts
insta-unfollow report --skip-verified

# Custom output file
insta-unfollow report --output my-report.md
```

The generated report looks like this:

```markdown
# Instagram Non-Followers Report

> **Generated:** 2026-03-24 11:30 UTC | **Following:** 2200 | **Follow back:** 1650 | **Don't follow back:** 550

| # | Username | Name | Verified |
|--:|----------|------|:--------:|
| 1 | [@someuser](https://instagram.com/someuser) | Some Person | |
| 2 | [@brand](https://instagram.com/brand) | Brand Name | ✅ |
...
```

Each username links directly to their Instagram profile — click to review before unfollowing.

### `stats` — Account Summary

Quick stats from your last scan.

```bash
insta-unfollow stats
```

```
  Account Stats
  ────────────────────────────────────
  Following:              2200
  Followers:              1650
  Mutual:                 1650
  Don't follow back:      550
  Follow-back ratio:      75.0%
```

## JSON Output

All commands support `--json` for scriptable output:

```bash
insta-unfollow scan --json | jq '.not_following_back'
insta-unfollow check --json | jq '.users[].username'
insta-unfollow offline followers.json following.json --json | jq '.users'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `INSTA_COOKIES` | Cookie string, alternative to `--cookies` flag or `login` command |

```bash
export INSTA_COOKIES="ds_user_id=123; csrftoken=abc; sessionid=xyz"
insta-unfollow scan
```

## Rate Limiting

This tool implements conservative rate limiting based on empirical testing:

| Operation | Delay | Burst Pause |
|-----------|-------|-------------|
| Scan (GraphQL) | 1-1.2s between requests | 10s every 6 requests |
| Verify (Profile API) | 1.5s between requests | 30s every 50 requests |
| Unfollow | 3-4s between unfollows | 5 min every 15 unfollows |

If Instagram returns a 429 (rate limit), the tool automatically waits 60 seconds before retrying.

**Going faster risks temporary blocks from Instagram.** The built-in limits are tuned to avoid this.

## Security

### Zero External Servers

Every single network request goes to `instagram.com`. Period.

- ❌ No telemetry
- ❌ No analytics
- ❌ No tracking
- ❌ No data sent anywhere except Instagram's own servers
- ✅ 100% open source — read every line

### Local Credential Storage

Cookies are stored in `~/.insta-unfollow/auth.json` with `600` file permissions (owner-only read/write). They never leave your machine.

### What the Code Does

1. Reads your existing Instagram session cookies
2. Makes the same API calls that Instagram's own web app makes
3. Shows you the results
4. Only unfollows when you explicitly confirm

That's it. No magic, no hidden behavior.

## Instagram Terms of Service

⚠️ **Disclaimer:** Using automated tools with Instagram may violate their [Terms of Service](https://help.instagram.com/581066165581870). Use this tool at your own risk. The authors are not responsible for any account restrictions.

The rate limits in this tool are designed to mimic human browsing patterns, but Instagram may still detect and temporarily restrict automated activity.

## AI Agent Integration

This tool includes an [OpenClaw](https://openclaw.com) skill file at `skill/SKILL.md` for AI agent integration. OpenClaw agents can use this skill to help users audit and clean their Instagram following list through natural conversation.

## Development

```bash
# Clone and install
git clone https://github.com/gonzalopezgil/insta-unfollow-cli.git
cd insta-unfollow-cli
npm install

# Build
npm run build

# Watch mode
npm run dev

# Type check
npm run typecheck
```

## Tech Stack

- **TypeScript** (strict mode)
- **Node.js 18+** (native `fetch`, no HTTP libraries)
- **Zero heavy dependencies** — only [commander](https://github.com/tj/commander.js) (CLI), [chalk](https://github.com/chalk/chalk) (colors), [ora](https://github.com/sindresorhus/ora) (spinners)
- **tsup** for building (single ESM bundle)

## License

[MIT](LICENSE) © Gonzalo López Gil
