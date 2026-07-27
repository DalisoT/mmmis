import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { StockSheetRow } from './stockSheet.service';

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 14, fontWeight: 'bold' },
  small: { fontSize: 8, color: '#555' },
  table: { borderWidth: 1, borderColor: '#222' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#bbb' },
  trLast: { flexDirection: 'row' },
  th: {
    fontWeight: 'bold', backgroundColor: '#eee', padding: 4, fontSize: 8,
  },
  td: { padding: 4, fontSize: 8 },
  cell: { borderRightWidth: 0.5, borderColor: '#999' },
  right: { textAlign: 'right' },
  totals: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
});

interface Props {
  date: string;
  rows: StockSheetRow[];
  recordedBy: string;
}

/**
 * PDF render of the daily stock sheet. Field names match the paper form.
 */
export function StockSheetPDF({ date, rows, recordedBy }: Props) {
  const totals = rows.reduce(
    (acc, r) => ({
      stock_bf: acc.stock_bf + r.stock_bf,
      stock_rcv: acc.stock_rcv + r.stock_rcv,
      allergy: acc.allergy + r.allergy,
      sold: acc.sold + r.sold,
      stock_cf: acc.stock_cf + r.stock_cf,
      total: acc.total + r.total,
    }),
    { stock_bf: 0, stock_rcv: 0, allergy: 0, sold: 0, stock_cf: 0, total: 0 }
  );

  // Column widths in percentage points (out of 100)
  const widths = {
    no: '4%',
    product: '22%',
    bf: '8%',
    rcv: '8%',
    totalStock: '8%',
    allergy: '8%',
    sold: '8%',
    cf: '8%',
    price: '12%',
    total: '12%',
    notes: '12%',
  };

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>DAILY STOCK SHEET</Text>
            <Text style={styles.small}>Military Mess Management Information System</Text>
          </View>
          <View>
            <Text>Date: <Text style={{ fontWeight: 'bold' }}>{date}</Text></Text>
            <Text style={styles.small}>Recorded by: {recordedBy}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.tr, { backgroundColor: '#eee' }]}>
            <Text style={[styles.th, styles.cell, { width: widths.no }]}>#</Text>
            <Text style={[styles.th, styles.cell, { width: widths.product }]}>Product</Text>
            <Text style={[styles.th, styles.cell, styles.right, { width: widths.bf }]}>Stock BF</Text>
            <Text style={[styles.th, styles.cell, styles.right, { width: widths.rcv }]}>Stock RCV</Text>
            <Text style={[styles.th, styles.cell, styles.right, { width: widths.totalStock }]}>Total Stock</Text>
            <Text style={[styles.th, styles.cell, styles.right, { width: widths.allergy }]}>Allergy</Text>
            <Text style={[styles.th, styles.cell, styles.right, { width: widths.sold }]}>Sold</Text>
            <Text style={[styles.th, styles.cell, styles.right, { width: widths.cf }]}>Stock CF</Text>
            <Text style={[styles.th, styles.cell, styles.right, { width: widths.price }]}>Price</Text>
            <Text style={[styles.th, styles.cell, styles.right, { width: widths.total }]}>Total</Text>
            <Text style={[styles.th, { width: widths.notes }]}>Notes</Text>
          </View>

          {rows.map((r, i) => (
            <View key={r.id ?? r.product_id} style={styles.tr}>
              <Text style={[styles.td, styles.cell, { width: widths.no }]}>{i + 1}</Text>
              <Text style={[styles.td, styles.cell, { width: widths.product }]}>{r.product?.name ?? '—'}</Text>
              <Text style={[styles.td, styles.cell, styles.right, { width: widths.bf }]}>{r.stock_bf}</Text>
              <Text style={[styles.td, styles.cell, styles.right, { width: widths.rcv }]}>{r.stock_rcv}</Text>
              <Text style={[styles.td, styles.cell, styles.right, { width: widths.totalStock }]}>{r.total_stock}</Text>
              <Text style={[styles.td, styles.cell, styles.right, { width: widths.allergy }]}>{r.allergy}</Text>
              <Text style={[styles.td, styles.cell, styles.right, { width: widths.sold }]}>{r.sold}</Text>
              <Text style={[styles.td, styles.cell, styles.right, { width: widths.cf }]}>{r.stock_cf}</Text>
              <Text style={[styles.td, styles.cell, styles.right, { width: widths.price }]}>{r.price.toFixed(2)}</Text>
              <Text style={[styles.td, styles.cell, styles.right, { width: widths.total }]}>{r.total.toFixed(2)}</Text>
              <Text style={[styles.td, { width: widths.notes }]}></Text>
            </View>
          ))}

          <View style={styles.trLast}>
            <Text style={[styles.td, styles.cell, { width: widths.no }]}></Text>
            <Text style={[styles.td, styles.cell, { width: widths.product, fontWeight: 'bold' }]}>TOTALS</Text>
            <Text style={[styles.td, styles.cell, styles.right, { width: widths.bf, fontWeight: 'bold' }]}>{totals.stock_bf}</Text>
            <Text style={[styles.td, styles.cell, styles.right, { width: widths.rcv, fontWeight: 'bold' }]}>{totals.stock_rcv}</Text>
            <Text style={[styles.td, styles.cell, styles.right, { width: widths.totalStock }]}></Text>
            <Text style={[styles.td, styles.cell, styles.right, { width: widths.allergy, fontWeight: 'bold' }]}>{totals.allergy}</Text>
            <Text style={[styles.td, styles.cell, styles.right, { width: widths.sold, fontWeight: 'bold' }]}>{totals.sold}</Text>
            <Text style={[styles.td, styles.cell, styles.right, { width: widths.cf, fontWeight: 'bold' }]}>{totals.stock_cf}</Text>
            <Text style={[styles.td, styles.cell, styles.right, { width: widths.price }]}></Text>
            <Text style={[styles.td, styles.cell, styles.right, { width: widths.total, fontWeight: 'bold' }]}>{totals.total.toFixed(2)}</Text>
            <Text style={[styles.td, { width: widths.notes }]}></Text>
          </View>
        </View>

        <View style={styles.totals}>
          <Text style={styles.small}>Field names per the original paper stock sheet.</Text>
          <Text>Generated: {new Date().toLocaleString()}</Text>
        </View>
      </Page>
    </Document>
  );
}
