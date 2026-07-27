import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from './table';

export interface ResponsiveCardField<T> {
  /** Visible label shown above the value, e.g. "Service #" */
  label: string;
  /** Pull the cell content via a render function. Returning null omits the field. */
  value: (row: T) => ReactNode;
  /** Optional class for the field block on phone. */
  className?: string;
  /** Span across the full row (useful for "message" lines). */
  fullWidth?: boolean;
  /** Highlight this field (e.g. an over-limit balance). */
  emphasis?: boolean;
}

interface ResponsiveTableProps<T> {
  /** The data rows. */
  rows: readonly T[];
  /** Stable key extractor. */
  rowKey: (row: T) => string;
  /** Column headers (used for the table view and for the card view ordering). */
  headers: string[];
  /** Cell renderers, one per header. Each is a function that returns the cell content for a row. */
  cells: Array<(row: T) => ReactNode>;
  /** Optional per-column alignment class for the table view. */
  headerClassNames?: string[];
  /** Card fields for the phone view. If omitted, the cards derive from `headers` + `cells`. */
  cardFields?: ResponsiveCardField<T>[];
  /** Optional card title (e.g. member name). Rendered prominently. */
  cardTitle?: (row: T) => ReactNode;
  /** Optional card subtitle (e.g. service number). */
  cardSubtitle?: (row: T) => ReactNode;
  /** Optional card badge slot (top right). */
  cardBadge?: (row: T) => ReactNode;
  /** Optional card click handler — turns each card into a button. */
  onRowClick?: (row: T) => void;
  /** Override the empty state. */
  empty?: ReactNode;
  /** Force a specific mode. By default: hidden md+ for cards, hidden <md for table. */
  force?: 'auto' | 'table' | 'cards';
  /** Cap on how many rows to render in the card view (for huge datasets). */
  cardCap?: number;
}

/**
 * A table that flips to a card list on phone.
 *
 * - `md+` (>= 768px): renders the same `Table` you were already using.
 * - `< md` (phone): renders a vertical card list, one card per row.
 *
 * Use this anywhere you currently use `Table` + `TableHeader` + `TableBody`.
 * The `cells` array drives both the table cells and the card fields (unless
 * `cardFields` is provided, in which case the cards are derived from those).
 */
export function ResponsiveTable<T>({
  rows, rowKey, headers, cells, headerClassNames = [],
  cardFields, cardTitle, cardSubtitle, cardBadge, onRowClick,
  empty, force = 'auto', cardCap,
}: ResponsiveTableProps<T>) {
  // Derive default card fields from the table cells if not provided.
  const fields: ResponsiveCardField<T>[] = cardFields ?? headers.map((h, i) => ({
    label: h,
    value: (row: T) => cells[i]?.(row) ?? null,
  }));

  const showTable = force !== 'cards';
  const showCards = force !== 'table';

  const cardRows = cardCap && rows.length > cardCap ? rows.slice(0, cardCap) : rows;
  const truncated = cardCap ? rows.length - cardRows.length : 0;

  return (
    <>
      {showTable && (
        <div className={cn('hidden md:block', force === 'table' && 'block')}>
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((h, i) => (
                  <TableHead key={h} className={headerClassNames[i]}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.length} className="text-center text-sm text-muted-foreground">
                    {empty ?? 'No data.'}
                  </TableCell>
                </TableRow>
              ) : rows.map((r) => (
                <TableRow key={rowKey(r)}>
                  {cells.map((c, i) => (
                    <TableCell key={i}>{c(r)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {showCards && (
        <div className={cn('space-y-3 md:hidden', force === 'cards' && 'block')}>
          {rows.length === 0 ? (
            <div className="rounded-lg border bg-card p-4 text-center text-sm text-muted-foreground">
              {empty ?? 'No data.'}
            </div>
          ) : (
            <>
              {cardRows.map((r) => {
                const Tag = onRowClick ? 'button' : 'div';
                return (
                  <Tag
                    key={rowKey(r)}
                    type={onRowClick ? 'button' : undefined}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={cn(
                      'block w-full rounded-lg border bg-card p-3 text-left shadow-sm transition-colors',
                      onRowClick && 'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    )}
                  >
                    {(cardTitle || cardSubtitle || cardBadge) && (
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {cardTitle && <div className="truncate font-medium">{cardTitle(r)}</div>}
                          {cardSubtitle && <div className="truncate text-xs text-muted-foreground">{cardSubtitle(r)}</div>}
                        </div>
                        {cardBadge && <div className="shrink-0">{cardBadge(r)}</div>}
                      </div>
                    )}
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                      {fields.map((f, i) => {
                        const v = f.value(r);
                        if (v === null || v === undefined || v === '') return null;
                        return (
                          <div key={i} className={cn('min-w-0', f.fullWidth && 'col-span-2', f.className)}>
                            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                            <dd className={cn('truncate', f.emphasis && 'font-semibold')}>{v}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </Tag>
                );
              })}
              {truncated > 0 && (
                <p className="rounded-lg border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground">
                  + {truncated.toLocaleString()} more row{truncated === 1 ? '' : 's'} (refine the filter to see them on phone)
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
