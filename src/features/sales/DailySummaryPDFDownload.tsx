import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { DailySummaryPDF } from './DailySummaryPDF';
import type { SaleRow } from './sales.service';
import type { ExpenseRow } from './dailyExpense.type';

interface Props {
  date: string;
  sales: SaleRow[];
  expenses: (ExpenseRow & { released_by_name?: string })[];
  chitRecovery: number;
  cashier: string;
  totals: {
    cash_sales: number;
    chit_sales: number;
    expenses: number;
    sale_count: number;
    item_count: number;
  };
}

/**
 * Self-contained PDF download button. This file is the lazy-load boundary:
 * importing @react-pdf/renderer + DailySummaryPDF here keeps them out of
 * the parent route chunk. Vite will create a separate JS chunk for this
 * module and fetch it on demand.
 */
export function PdfDownloadButton({
  date, sales, expenses, chitRecovery, cashier, totals,
}: Props) {
  return (
    <PDFDownloadLink
      document={
        <DailySummaryPDF
          date={date}
          sales={sales}
          expenses={expenses}
          chitRecovery={chitRecovery}
          cashier={cashier}
          totals={totals}
        />
      }
      fileName={`daily-summary-${date}.pdf`}
      className="inline-flex"
    >
      {({ loading }) => (
        <Button size="sm" variant="secondary" disabled={loading}>
          {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
          Save as PDF
        </Button>
      )}
    </PDFDownloadLink>
  );
}