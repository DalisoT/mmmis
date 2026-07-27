import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { format } from 'date-fns';
import type { SaleRow } from './sales.service';
import type { ExpenseRow } from './dailyExpense.type';

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 10, fontFamily: 'Helvetica', color: '#111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: 'bold' },
  small: { fontSize: 9, color: '#555' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: 'bold', marginBottom: 4, borderBottom: '1pt solid #222', paddingBottom: 2 },
  table: { borderTop: '1pt solid #222', borderLeft: '1pt solid #222' },
  tr: { flexDirection: 'row', borderBottom: '1pt solid #bbb' },
  th: { backgroundColor: '#eee', padding: 4, fontWeight: 'bold', fontSize: 9, borderRight: '1pt solid #bbb' },
  td: { padding: 4, fontSize: 9, borderRight: '1pt solid #bbb' },
  totals: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, padding: 6, backgroundColor: '#f4f4f4' },
  totalBox: { alignItems: 'center' },
  totalLabel: { fontSize: 8, color: '#555' },
  totalValue: { fontSize: 13, fontWeight: 'bold' },
});

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

export function DailySummaryPDF({ date, sales, expenses, chitRecovery, cashier, totals }: Props) {
  const grandCash = totals.cash_sales + chitRecovery - totals.expenses;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>DAILY SUMMARY</Text>
            <Text style={styles.small}>Military Mess Management Information System</Text>
          </View>
          <View>
            <Text>Date: <Text style={{ fontWeight: 'bold' }}>{date}</Text></Text>
            <Text style={styles.small}>Cashier: {cashier}</Text>
            <Text style={styles.small}>Generated: {format(new Date(), 'yyyy-MM-dd HH:mm')}</Text>
          </View>
        </View>

        <View style={styles.totals}>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Cash Sales</Text>
            <Text style={styles.totalValue}>{totals.cash_sales.toFixed(2)}</Text>
          </View>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>CHIT Sales</Text>
            <Text style={styles.totalValue}>{totals.chit_sales.toFixed(2)}</Text>
          </View>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>CHIT Recovery</Text>
            <Text style={styles.totalValue}>{chitRecovery.toFixed(2)}</Text>
          </View>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Expenses</Text>
            <Text style={styles.totalValue}>{totals.expenses.toFixed(2)}</Text>
          </View>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Sales Count</Text>
            <Text style={styles.totalValue}>{totals.sale_count}</Text>
          </View>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Items Sold</Text>
            <Text style={styles.totalValue}>{totals.item_count}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SALES</Text>
          <View style={styles.table}>
            <View style={styles.tr}>
              <Text style={[styles.th, { width: '12%' }]}>Time</Text>
              <Text style={[styles.th, { width: '10%' }]}>Type</Text>
              <Text style={[styles.th, { width: '20%' }]}>Member</Text>
              <Text style={[styles.th, { width: '38%' }]}>Items</Text>
              <Text style={[styles.th, { width: '20%', textAlign: 'right' }]}>Amount</Text>
            </View>
            {sales.map((s) => (
              <View key={s.id} style={styles.tr}>
                <Text style={[styles.td, { width: '12%' }]}>{format(new Date(s.sold_at), 'HH:mm')}</Text>
                <Text style={[styles.td, { width: '10%' }]}>{s.sale_type.toUpperCase()}</Text>
                <Text style={[styles.td, { width: '20%' }]}>
                  {s.member ? `${s.member.service_number} ${s.member.first_name}` : '—'}
                </Text>
                <Text style={[styles.td, { width: '38%' }]}>
                  {s.items.map((i) => `${i.quantity}× ${i.product?.name ?? ''}`).join(', ')}
                </Text>
                <Text style={[styles.td, { width: '20%', textAlign: 'right' }]}>{s.total_amount.toFixed(2)}</Text>
              </View>
            ))}
            {sales.length === 0 && (
              <View style={styles.tr}>
                <Text style={[styles.td, { width: '100%', textAlign: 'center', color: '#888' }]}>No sales recorded</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>EXPENSES</Text>
          <View style={styles.table}>
            <View style={styles.tr}>
              <Text style={[styles.th, { width: '15%' }]}>Time</Text>
              <Text style={[styles.th, { width: '40%' }]}>Description</Text>
              <Text style={[styles.th, { width: '30%' }]}>Purpose</Text>
              <Text style={[styles.th, { width: '15%', textAlign: 'right' }]}>Amount</Text>
            </View>
            {expenses.map((e) => (
              <View key={e.id} style={styles.tr}>
                <Text style={[styles.td, { width: '15%' }]}>{format(new Date(e.created_at ?? e.expense_date), 'HH:mm')}</Text>
                <Text style={[styles.td, { width: '40%' }]}>{e.description}</Text>
                <Text style={[styles.td, { width: '30%' }]}>{e.purpose}</Text>
                <Text style={[styles.td, { width: '15%', textAlign: 'right' }]}>{e.amount.toFixed(2)}</Text>
              </View>
            ))}
            {expenses.length === 0 && (
              <View style={styles.tr}>
                <Text style={[styles.td, { width: '100%', textAlign: 'center', color: '#888' }]}>No expenses recorded</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.totals}>
          <Text style={styles.totalLabel}>Gross Cash at Hand (Cash Sales + Recovery − Expenses)</Text>
          <Text style={[styles.totalValue, { color: grandCash >= 0 ? '#0a6' : '#a00' }]}>
            {grandCash.toFixed(2)}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
