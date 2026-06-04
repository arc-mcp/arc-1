/**
 * SAP_BASIS release parsing helpers.
 *
 * Kept dependency-free (no imports) so it can be used from low-level modules
 * such as `errors.ts` without risking an import cycle through `features.ts`.
 *
 * SAP_BASIS release strings reported by `/sap/bc/adt/system/components` are
 * dotless three-digit codes: "700", "740", "750", "757", "758", "816". Note the
 * 8xx jump: SAP renumbered from the 7.5x line (758 = S/4HANA 2023) straight to
 * 8.16 (816 = ABAP Platform 2025 / S/4HANA 2025) because quarterly S/4HANA Cloud
 * Public Edition consumed releases 759–815. Plain numeric comparison still orders
 * them correctly (816 > 758), so no special-casing is needed. Releases below
 * 751 lack native honoring of the `X-sap-adt-sessiontype: stateful` header over
 * HTTP (the 7.51+ `CONFIGURE_SESSION_STATE` of `CL_ADT_WB_RES_APP` does not
 * exist), so ADT writes fail with `423 invalid lock handle` unless the
 * `abapfs_extensions` enhancement is installed. See issue #293.
 */

/** The release at and above which ADT honors stateful HTTP sessions natively. */
export const STATEFUL_SESSION_MIN_RELEASE = 751;

/**
 * Parse a SAP_BASIS release string into a comparable integer.
 *
 * Strips any non-digit characters first, so both dotless ("750") and dotted
 * ("7.50") forms map to the same number (750). Returns `undefined` when the
 * input is empty/undefined or contains no digits.
 */
export function parseReleaseNumber(release?: string): number | undefined {
  if (!release) return undefined;
  const digits = release.replace(/\D/g, '');
  if (digits.length === 0) return undefined;
  const num = Number.parseInt(digits, 10);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * True when the detected release is known to be below the stateful-session
 * threshold (i.e. ADT HTTP writes need the abapfs_extensions enhancement).
 * Returns false when the release is unknown — never cry wolf on missing data.
 */
export function isPreStatefulRelease(abapRelease?: string): boolean {
  const num = parseReleaseNumber(abapRelease);
  return num !== undefined && num < STATEFUL_SESSION_MIN_RELEASE;
}

/**
 * Decide whether to emit the startup warning about pre-7.51 write support:
 * only when writes are enabled AND the detected release is known to be < 7.51.
 */
export function shouldWarnPreStatefulRelease(allowWrites: boolean, abapRelease?: string): boolean {
  return allowWrites === true && isPreStatefulRelease(abapRelease);
}
