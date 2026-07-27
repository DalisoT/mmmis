/**
 * CSV helpers — used by every page that lets the user export a table.
 *
 * Conventions enforced here (so the individual exporters don't have to):
 *
 *  1. RFC 4180 escaping: any value containing a comma, double-quote, or
 *     newline is wrapped in double-quotes; internal quotes are doubled.
 *     Otherwise the value is emitted as-is.
 *  2. UTF-8 BOM prefix on download, so Excel on Windows auto-detects encoding
 *     and renders non-ASCII characters correctly (without the BOM, Excel
 *     treats the file as Windows-1252 and shows mojibake for umlauts / etc.).
 *  3. The anchor is appended to the document body before clicking, then
 *     removed. Firefox refuses to honor a programmatic `<a>.click()` on
 *     anchors that aren't in the DOM.
 *  4. The object URL is revoked after the click, so the browser doesn't
 *     keep the blob alive in memory.
 *
 * The shared helpers keep the call sites tiny:
 *
 *   downloadCsv('expenses-2026-01-01-2026-01-31.csv', [
 *     ['Date', 'Description', 'Amount'],
 *     ['2026-01-01', 'Cleaning supplies', 120.5],
 *   ]);
 */

/**
 * One CSV cell. Primitives are coerced to their string form.
 * null / undefined become empty cells (not the literal "null" / "undefined").
 * Date is serialised via toISOString() so output is deterministic.
 */
export type CsvField =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date;

/**
 * Escape a single field per RFC 4180.
 *
 * - Numbers, booleans, dates, null, and undefined are first coerced to a
 *   string.
 * - If the resulting string contains a comma, double-quote, CR, or LF, it
 *   is wrapped in double-quotes and any internal double-quotes are doubled.
 * - Otherwise it is returned as-is (no surrounding quotes).
 */
export function csvEscape(value: CsvField): string {
  if (value === null || value === undefined) return '';
  const str =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'string'
        ? value
        : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build a CSV string from a 2D array of fields. The first row is typically
 * the header row. Every value is escaped via {@link csvEscape}.
 *
 * Rows are joined with `\n` (LF). No BOM is added — callers that want a
 * download should use {@link downloadCsv} which prepends the BOM.
 */
export function toCsv(rows: readonly CsvField[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

/**
 * ISO timestamp safe for use in filenames.
 * Example: `2026-07-26T23-15-04Z`.
 */
export function csvTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Trigger a browser download of a CSV file.
 *
 * Prepends a UTF-8 BOM, builds a Blob, and clicks a temporary `<a download>`.
 * The anchor is appended to the document body (Firefox requirement) and
 * removed; the object URL is revoked after a short delay to avoid races
 * with the browser's download pipeline.
 */
export function downloadCsv(
  filename: string,
  rows: readonly CsvField[][],
): void {
  const BOM = '\uFEFF';
  const csv = BOM + toCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Defer revoke so the browser has time to start the download. revoking
  // immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}