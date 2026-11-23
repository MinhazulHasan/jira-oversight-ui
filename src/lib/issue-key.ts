/**
 * Jira issue keys: a project key of 2 to 10 characters (a letter first, then
 * letters, digits or underscores) and a number. Readers type them loosely
 * ("demo-12", "DEMO 12", "#12"), so the palette normalises before it offers
 * to open one.
 */

const STRICT = /^[A-Z][A-Z0-9_]{1,9}-[1-9]\d{0,8}$/;
const LOOSE = /^([A-Za-z][A-Za-z0-9_]{1,9})[-\s]+0*(\d{1,9})$/;
const NUMBER_ONLY = /^#?0*(\d{1,9})$/;

/** True for a canonical key such as "DEMO-142". */
export function isIssueKey(value: string): boolean {
  return STRICT.test(value);
}

/**
 * The key in an /issues/<key> address, upper-cased ("demo-12" is DEMO-12), or
 * null when the segment does not decode or is not a key. The issue page and
 * the proxy both read the address this way, so they agree on what is a 404.
 */
export function issueKeyFromSegment(segment: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(segment).toUpperCase();
  } catch {
    return null;
  }
  return isIssueKey(key) ? key : null;
}

/**
 * The canonical key the reader most likely means, or null.
 * A bare number is read as an issue in the default project, when there is one.
 */
export function parseIssueKey(input: string, defaultProject?: string): string | null {
  const text = input.trim();

  const loose = LOOSE.exec(text);
  if (loose) {
    const key = `${loose[1].toUpperCase()}-${Number(loose[2])}`;
    return isIssueKey(key) ? key : null;
  }

  const bare = NUMBER_ONLY.exec(text);
  if (bare && defaultProject) {
    const key = `${defaultProject.toUpperCase()}-${Number(bare[1])}`;
    return isIssueKey(key) ? key : null;
  }

  return null;
}
