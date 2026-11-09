// The one short form of a commit id, used by the staleness header and the startup line: a full hex sha is cut
// to 10 characters, anything else ("unversioned", a branch name) is shown whole.
export const shortSha = (s: string): string => (/^[0-9a-f]{11,}$/i.test(s) ? s.slice(0, 10) : s);
