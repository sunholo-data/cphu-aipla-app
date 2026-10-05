/**
 * Live vs historical group codes on a class (1.1.146).
 *
 * Revoke ends ACCESS, never evidence: a revoked code stays in
 * `cls.groupCodes` — the roster every evidence surface reads — and is also
 * listed in `cls.revokedGroupCodes`. Anything that shows codes a teacher can
 * still hand out, reset or count as "groups in use" reads `activeGroupCodes`;
 * anything that shows history (reports, sessions) reads `groupCodes`.
 */

interface ClassCodes {
  groupCodes: string[];
  revokedGroupCodes?: string[];
}

/** Codes that still work — `groupCodes` minus the revoked ones. */
export function activeGroupCodes(cls: ClassCodes): string[] {
  const revoked = new Set(cls.revokedGroupCodes ?? []);
  return cls.groupCodes.filter((c) => !revoked.has(c));
}

/** Revoked codes, in roster order (then any the roster lacks). Their
 *  sessions remain reviewable. */
export function revokedGroupCodes(cls: ClassCodes): string[] {
  const revoked = cls.revokedGroupCodes ?? [];
  const set = new Set(revoked);
  const inRoster = cls.groupCodes.filter((c) => set.has(c));
  const seen = new Set(inRoster);
  return [...inRoster, ...revoked.filter((c) => !seen.has(c))];
}
