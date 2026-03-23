import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAuth, getConfigDir } from '../auth/cookies.js';
import { verifyProfile } from '../api/instagram.js';
import { formatStats, formatError } from '../utils/format.js';
import type { ScanResult, AccountStats } from '../api/types.js';

export interface StatsOptions {
  cookies?: string;
  json?: boolean;
}

export async function statsCommand(options: StatsOptions): Promise<void> {
  // Try to load scan results first
  const scanFile = join(getConfigDir(), 'scan-results.json');
  let fromScan = false;
  let stats: AccountStats;

  if (existsSync(scanFile)) {
    try {
      const scanResult = JSON.parse(await readFile(scanFile, 'utf-8')) as ScanResult;
      const following = scanResult.users.length;
      const mutual = scanResult.users.filter((u) => u.follows_viewer).length;
      const notFollowingBack = following - mutual;

      // Try to get follower count from the API
      let followers = 0;
      try {
        const auth = await getAuth(options.cookies);
        const profile = await verifyProfile(auth, scanResult.users[0]?.username ?? '');
        if (profile) {
          followers = profile.follower_count;
        }
      } catch {
        // If we can't get follower count, estimate from scan data
        followers = mutual; // At minimum, mutual followers
      }

      stats = {
        following,
        followers,
        mutual,
        not_following_back: notFollowingBack,
        ratio: following > 0 ? (mutual / following) * 100 : 0,
      };
      fromScan = true;
    } catch {
      // Fall through to API check
    }
  }

  if (!fromScan) {
    // No scan results — try to get basic stats from API
    let auth;
    try {
      auth = await getAuth(options.cookies);
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: (error as Error).message }));
      } else {
        console.log(formatError((error as Error).message));
        console.log('  Run `insta-unfollow scan` first for detailed stats.\n');
      }
      process.exitCode = 1;
      return;
    }

    // We need at least a scan to compute meaningful stats
    const msg = 'No scan data available. Run `insta-unfollow scan` first for detailed stats.';
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: msg }));
    } else {
      console.log(formatError(msg));
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ success: true, ...stats! }));
  } else {
    console.log(formatStats(stats!));
  }
}
