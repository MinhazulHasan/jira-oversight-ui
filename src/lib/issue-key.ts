const STRICT = /^[A-Z][A-Z0-9_]{1,9}-[1-9]\d{0,8}$/;
const LOOSE = /^([A-Za-z][A-Za-z0-9_]{1,9})[-\s]+0*(\d{1,9})$/;
const NUMBER_ONLY = /^#?0*(\d{1,9})$/;

/** True for a canonical key such as "DEMO-142". */
export function isIssueKey(value: string): boolean {
  return STRICT.test(value);
}

export function issueKeyFromSegment(segment: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(segment).toUpperCase();
  } catch {
    return null;
  }
  return isIssueKey(key) ? key : null;
}

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
