import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';
import { getAuth, getConfigDir } from '../auth/cookies.js';
import { unfollowUser, verifyProfiles } from '../api/instagram.js';
import { createRateLimiter, RATE_LIMITS, sleep } from '../utils/rate-limit.js';
import { formatNonFollowersTable, formatUnfollowResult, formatError, formatWarning } from '../utils/format.js';
import type { ScanResult, VerifiedUser } from '../api/types.js';

export interface UnfollowOptions {
  cookies?: string;
  batch?: number;
  interactive?: boolean;
  skipVerified?: boolean;
  dryRun?: boolean;
  input?: string;
  json?: boolean;
}

export async function unfollowCommand(options: UnfollowOptions): Promise<void> {
  const batchSize = options.batch ?? 10;
  const interactive = options.interactive !== false; // default true

  let auth;
  try {
    auth = await getAuth(options.cookies);
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: (error as Error).message }));
    } else {
      console.log(formatError((error as Error).message));
    }
    process.exitCode = 1;
    return;
  }

  // Load scan results
  const scanFile = options.input ?? join(getConfigDir(), 'scan-results.json');
  if (!existsSync(scanFile)) {
    const msg = 'No scan results found. Run `insta-unfollow scan` first.';
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: msg }));
    } else {
      console.log(formatError(msg));
    }
    process.exitCode = 1;
    return;
  }

  let scanResult: ScanResult;
  try {
    scanResult = JSON.parse(await readFile(scanFile, 'utf-8')) as ScanResult;
  } catch {
    const msg = `Failed to parse scan results from ${scanFile}`;
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: msg }));
    } else {
      console.log(formatError(msg));
    }
    process.exitCode = 1;
    return;
  }

  // Get non-followers
  let candidates = scanResult.users.filter((u) => !u.follows_viewer);
  if (options.skipVerified) {
    const before = candidates.length;
    candidates = candidates.filter((u) => !u.is_verified);
    if (!options.json && before !== candidates.length) {
      console.log(formatWarning(`Skipped ${before - candidates.length} verified accounts`));
    }
  }

  if (candidates.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, unfollowed: 0 }));
    } else {
      console.log(chalk.green('\n  No non-followers to unfollow! 🎉\n'));
    }
    return;
  }

  if (!options.json) {
    console.log(`\n  Found ${chalk.yellow(candidates.length)} non-followers.`);
    if (options.dryRun) {
      console.log(chalk.yellow('  DRY RUN — no accounts will be unfollowed.\n'));
    }
  }

  // Verify before unfollowing
  if (!options.json) {
    console.log(chalk.gray('  Verifying accounts before unfollowing...\n'));
  }

  const spinner = options.json ? null : ora('Verifying...').start();
  const profiles = await verifyProfiles(auth, candidates.map((u) => u.username), {
    onProgress: (done, total) => {
      if (spinner) spinner.text = `Verifying... ${done}/${total}`;
    },
  });
  spinner?.succeed('Verification complete');

  // Build verified non-followers list
  const verified: VerifiedUser[] = [];
  for (const user of candidates) {
    const profile = profiles.get(user.username);
    if (!profile) continue;
    if (profile.follows_viewer) continue; // Actually follows now

    verified.push({
      id: user.id,
      username: profile.username,
      full_name: profile.full_name,
      is_verified: profile.is_verified,
      follows_viewer: false,
      followed_by_viewer: profile.followed_by_viewer,
      exists: true,
    });
  }

  if (verified.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, unfollowed: 0, message: 'No confirmed non-followers' }));
    } else {
      console.log(chalk.green('\n  All accounts verified — no confirmed non-followers! 🎉\n'));
    }
    return;
  }

  const rl = interactive && !options.json
    ? readline.createInterface({ input, output })
    : null;

  let totalUnfollowed = 0;
  const results: Array<{ username: string; success: boolean }> = [];
  const wait = createRateLimiter(RATE_LIMITS.unfollow);

  try {
    // Process in batches
    for (let batchStart = 0; batchStart < verified.length; batchStart += batchSize) {
      const batch = verified.slice(batchStart, batchStart + batchSize);

      if (!options.json) {
        console.log(`\n${chalk.bold(`Batch ${Math.floor(batchStart / batchSize) + 1} (${batch.length} accounts):`)}`);
        console.log(formatNonFollowersTable(batch, batchStart));
      }

      if (interactive && rl) {
        console.log('');
        const answer = await rl.question(
          chalk.yellow('  Unfollow all in this batch? (y/n/quit): '),
        );

        if (answer.toLowerCase() === 'quit' || answer.toLowerCase() === 'q') {
          console.log(chalk.gray('\n  Stopped by user.\n'));
          break;
        }

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log(chalk.gray('  Skipped this batch.\n'));
          continue;
        }
      }

      // Execute unfollows
      for (const user of batch) {
        if (options.dryRun) {
          if (!options.json) {
            console.log(`  ${chalk.gray('[DRY RUN]')} Would unfollow ${chalk.cyan('@' + user.username)}`);
          }
          results.push({ username: user.username, success: true });
          totalUnfollowed++;
          continue;
        }

        await wait();

        const result = await unfollowUser(auth, user.id, user.username);
        results.push({ username: result.username, success: result.success });

        if (!options.json) {
          console.log(formatUnfollowResult(result.username, result.success));
        }

        if (result.success) {
          totalUnfollowed++;
        } else if (result.error?.includes('Rate limited')) {
          if (!options.json) {
            console.log(formatWarning('Rate limited — waiting 5 minutes...'));
          }
          await sleep(300_000);
        }
      }

      // Pause between batches if there are more
      if (batchStart + batchSize < verified.length && !options.dryRun) {
        if (!options.json) {
          console.log(chalk.gray('\n  Pausing between batches...\n'));
        }
        await sleep(5_000);
      }
    }
  } finally {
    rl?.close();
  }

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      total_unfollowed: totalUnfollowed,
      total_candidates: verified.length,
      dry_run: options.dryRun ?? false,
      results,
    }));
  } else {
    console.log(`\n  ${chalk.bold('Done!')} Unfollowed ${chalk.green(totalUnfollowed)} accounts.\n`);
  }
}
