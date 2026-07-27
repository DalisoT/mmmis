/** Shared minimal shape used by DailySummaryPDF and the page. */
export interface ExpenseRow {
  id: string;
  expense_date: string;
  description: string;
  amount: number;
  purpose: string;
  remarks: string | null;
  released_by: string | null;
  created_at?: string;
}
