import type {
  AuthConfig,
  IGEdgeFollow,
  IGProfileInfo,
  IGUserNode,
  UnfollowResult,
} from './types.js';
import { buildCookieHeader } from '../auth/cookies.js';
import { createRateLimiter, RATE_LIMITS, sleep } from '../utils/rate-limit.js';

const IG_APP_ID = '936619743392459';
const GRAPHQL_QUERY_HASH = '3dec7e2c57367ef3da3d987d89f9dbc8';

/** Common headers for all Instagram requests */
function baseHeaders(auth: AuthConfig): Record<string, string> {
  return {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cookie': buildCookieHeader(auth),
    'x-ig-app-id': IG_APP_ID,
  };
}

/**
 * Scan the user's following list via GraphQL.
 *
 * Fetches all accounts in paginated batches of 24.
 * Includes `follows_viewer` field for each account.
 */
export async function scanFollowing(
  auth: AuthConfig,
  options: {
    onProgress?: (fetched: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<IGUserNode[]> {
  const users: IGUserNode[] = [];
  let cursor: string | null = null;
  let hasNext = true;
  let total = -1;
  const wait = createRateLimiter(RATE_LIMITS.scan);

  while (hasNext) {
    if (options.signal?.aborted) break;

    await wait();

    const variables: Record<string, string | boolean> = {
      id: auth.ds_user_id,
      include_reel: true,
      fetch_mutual: false,
      first: 24,
    } as unknown as Record<string, string | boolean>;

    if (cursor) {
      (variables as Record<string, unknown>)['after'] = cursor;
    }

    const url = `https://www.instagram.com/graphql/query/?query_hash=${GRAPHQL_QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(variables))}`;

    const response = await fetch(url, {
      headers: baseHeaders(auth),
      signal: options.signal,
    });

    if (response.status === 429) {
      // Rate limited — wait and retry
      await sleep(60_000);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Authentication failed (HTTP ${response.status}). Your session may have expired. Run \`insta-unfollow login\` again.`,
      );
    }

    if (!response.ok) {
      throw new Error(`Instagram API error: HTTP ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as {
      data?: { user?: { edge_follow?: IGEdgeFollow } };
    };

    const edgeFollow = json?.data?.user?.edge_follow;
    if (!edgeFollow) {
      throw new Error('Unexpected API response format. Your session may have expired.');
    }

    if (total === -1) {
      total = edgeFollow.count;
    }

    for (const edge of edgeFollow.edges) {
      users.push(edge.node);
    }

    hasNext = edgeFollow.page_info.has_next_page;
    cursor = edgeFollow.page_info.end_cursor;

    options.onProgress?.(users.length, total);
  }

  return users;
}

/**
 * Verify a single user's profile via the web_profile_info API.
 *
 * Returns full profile info including follow relationship.
 */
export async function verifyProfile(
  auth: AuthConfig,
  username: string,
): Promise<IGProfileInfo | null> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const response = await fetch(url, {
    headers: baseHeaders(auth),
  });

  if (response.status === 404) {
    return null; // Account deleted/suspended
  }

  if (response.status === 429) {
    throw new Error('Rate limited by Instagram. Wait a few minutes and try again.');
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('Authentication failed. Run `insta-unfollow login` again.');
  }

  if (!response.ok) {
    throw new Error(`Instagram API error: HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: {
      user?: {
        username: string;
        full_name: string;
        is_verified: boolean;
        is_private: boolean;
        follows_viewer: boolean;
        followed_by_viewer: boolean;
        edge_followed_by?: { count: number };
        edge_follow?: { count: number };
      };
    };
  };

  const user = json?.data?.user;
  if (!user) return null;

  return {
    username: user.username,
    full_name: user.full_name,
    is_verified: user.is_verified,
    is_private: user.is_private,
    follows_viewer: user.follows_viewer,
    followed_by_viewer: user.followed_by_viewer,
    follower_count: user.edge_followed_by?.count ?? 0,
    following_count: user.edge_follow?.count ?? 0,
  };
}

/**
 * Verify multiple users with rate limiting.
 */
export async function verifyProfiles(
  auth: AuthConfig,
  usernames: string[],
  options: {
    onProgress?: (verified: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<Map<string, IGProfileInfo | null>> {
  const results = new Map<string, IGProfileInfo | null>();
  const wait = createRateLimiter(RATE_LIMITS.verify);

  for (let i = 0; i < usernames.length; i++) {
    if (options.signal?.aborted) break;

    const username = usernames[i]!;
    await wait();

    try {
      const profile = await verifyProfile(auth, username);
      results.set(username, profile);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Rate limited')) {
        // Wait and retry once
        await sleep(60_000);
        try {
          const profile = await verifyProfile(auth, username);
          results.set(username, profile);
        } catch {
          results.set(username, null);
        }
      } else {
        throw error;
      }
    }

    options.onProgress?.(i + 1, usernames.length);
  }

  return results;
}

/**
 * Unfollow a single user.
 */
export async function unfollowUser(
  auth: AuthConfig,
  userId: string,
  username: string,
): Promise<UnfollowResult> {
  const url = `https://www.instagram.com/web/friendships/${userId}/unfollow/`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...baseHeaders(auth),
        'content-type': 'application/x-www-form-urlencoded',
        'x-csrftoken': auth.csrftoken,
      },
    });

    if (response.status === 429) {
      return { username, user_id: userId, success: false, error: 'Rate limited. Wait a few minutes.' };
    }

    if (response.status === 401 || response.status === 403) {
      return { username, user_id: userId, success: false, error: 'Session expired. Run login again.' };
    }

    if (!response.ok) {
      return { username, user_id: userId, success: false, error: `HTTP ${response.status}` };
    }

    return { username, user_id: userId, success: true };
  } catch (error) {
    return {
      username,
      user_id: userId,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate that the current auth credentials are still working.
 *
 * Calls the profile API for the logged-in user.
 */
export async function validateAuth(auth: AuthConfig): Promise<{ valid: boolean; username?: string }> {
  try {
    // Use the user's own profile to validate
    const url = `https://www.instagram.com/api/v1/users/${auth.ds_user_id}/info/`;
    const response = await fetch(url, {
      headers: baseHeaders(auth),
    });

    if (!response.ok) {
      return { valid: false };
    }

    const json = (await response.json()) as { user?: { username?: string } };
    return { valid: true, username: json?.user?.username };
  } catch {
    return { valid: false };
  }
}
