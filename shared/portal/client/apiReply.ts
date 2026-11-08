/**
 * Reading an API reply without mistaking a server failure for a network failure.
 *
 * Every game endpoint answers in JSON. A reply that is not JSON means the platform answered instead:
 * the function crashed or ran out of time, and Vercel sent a plain-text error page. Calling
 * `res.json()` on that throws, and every game's catch block then told the player "Network error",
 * which sent anyone investigating after the wrong cause (November 2026: a crashed function reported
 * as a network error on starting a Thrash Margin campaign).
 */

/** The body of an API reply, or null when it is not a JSON object. */
export async function readJson(res: Response): Promise<Record<string, any> | null> {
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/** The message for a reply the server did not answer in JSON, naming the status so it can be traced. */
export function serverFailure(action: string, res: Response): string {
  return `The server failed while ${action} (error ${res.status}). Nothing was lost; try again in a moment.`;
}
