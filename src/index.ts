import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { scanCommand } from './commands/scan.js';
import { checkCommand } from './commands/check.js';
import { unfollowCommand } from './commands/unfollow.js';
import { offlineCommand } from './commands/offline.js';
import { statsCommand } from './commands/stats.js';

const program = new Command();

program
  .name('insta-unfollow')
  .description('Find Instagram accounts that don\'t follow you back and unfollow them.')
  .version('1.0.0');

// Login command
program
  .command('login')
  .description('Save your Instagram session cookies for API access')
  .option('--cookies <string>', 'Cookie string: "ds_user_id=XXX; csrftoken=XXX; sessionid=XXX"')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await loginCommand(options);
  });

// Scan command
program
  .command('scan')
  .description('Scan your following list via Instagram\'s GraphQL API')
  .option('--cookies <string>', 'Cookie string (overrides saved config)')
  .option('-o, --output <path>', 'Output file path (default: ~/.insta-unfollow/scan-results.json)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await scanCommand(options);
  });

// Check command
program
  .command('check')
  .description('Verify non-followers in real-time via Instagram\'s profile API')
  .option('--cookies <string>', 'Cookie string (overrides saved config)')
  .option('--skip-verified', 'Skip verified accounts (celebrities, brands)')
  .option('-i, --input <path>', 'Scan results file to use')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await checkCommand(options);
  });

// Unfollow command
program
  .command('unfollow')
  .description('Unfollow accounts that don\'t follow you back')
  .option('--cookies <string>', 'Cookie string (overrides saved config)')
  .option('-b, --batch <number>', 'Batch size for interactive approval', '10')
  .option('--interactive', 'Prompt for approval per batch (default: true)')
  .option('--no-interactive', 'Skip approval prompts (use with caution)')
  .option('--skip-verified', 'Skip verified accounts')
  .option('--dry-run', 'Show what would be unfollowed without doing it')
  .option('-i, --input <path>', 'Scan results file to use')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await unfollowCommand({
      ...options,
      batch: parseInt(options.batch, 10) || 10,
    });
  });

// Offline command
program
  .command('offline')
  .description('Analyze Instagram data export (no API calls needed)')
  .argument('<followers>', 'Path to followers JSON file (e.g., followers_1.json)')
  .argument('<following>', 'Path to following JSON file (e.g., following.json)')
  .option('--json', 'Output as JSON')
  .action(async (followers, following, options) => {
    await offlineCommand(followers, following, options);
  });

// Stats command
program
  .command('stats')
  .description('Show account stats summary from last scan')
  .option('--cookies <string>', 'Cookie string (overrides saved config)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await statsCommand(options);
  });

program.parse();
