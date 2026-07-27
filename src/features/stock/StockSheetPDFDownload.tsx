import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { StockSheetPDF } from './StockSheetPDF';
import type { StockSheetRow } from './stockSheet.service';

interface Props {
  date: string;
  rows: StockSheetRow[];
  recordedBy: string;
}

/**
 * Self-contained PDF download button. This file is the lazy-load boundary:
 * importing @react-pdf/renderer + StockSheetPDF here keeps them out of the
 * parent route chunk. Vite will create a separate JS chunk for this
 * module and fetch it on demand.
 */
export function PdfDownloadButton({ date, rows, recordedBy }: Props) {
  return (
    <PDFDownloadLink
      document={<StockSheetPDF date={date} rows={rows} recordedBy={recordedBy} />}
      fileName={`stock-sheet-${date}.pdf`}
      className="inline-flex"
    >
      {({ loading }) => (
        <Button size="sm" variant="secondary" disabled={loading}>
          {loading
            ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            : <FileText className="mr-1 h-4 w-4" />}
          Save as PDF
        </Button>
      )}
    </PDFDownloadLink>
  );
}