import './quietSqliteWarning';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildKaggleImport, parseCsv, parseDayFirst } from './kaggleImport';

const CSV = path.join(process.cwd(), 'data', 'kaggle', 'Daily_Household_Transactions.csv');
const have = fs.existsSync(CSV);
const NOW = Date.UTC(2026, 9, 25, 12);

test('CSV parser handles quotes, commas and newlines inside fields', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","he said ""hi"""\r\n"multi\nline",2\n'), [['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', '2']]);
});

test('dates are read day-first and impossible dates rejected', () => {
  assert.equal(new Date(parseDayFirst('20/09/2018 12:04:08')).toISOString(), '2018-09-20T12:04:08.000Z');
  assert.equal(new Date(parseDayFirst('1/1/2017')).toISOString(), '2017-01-01T12:00:00.000Z');
  assert.ok(Number.isNaN(parseDayFirst('31/02/2018')));
  assert.ok(Number.isNaN(parseDayFirst('2018-09-20')));
});

test('matches figures computed independently from the CSV', { skip: !have && 'dataset not present in data/kaggle' }, () => {
  const imp = buildKaggleImport(fs.readFileSync(CSV, 'utf-8'), 'u1', { now: NOW });
  // 2,176 Expense rows - 133 savings rows (Investment 103, PPF 8, RD 22).
  assert.equal(imp.counts.rows, 2461);
  assert.equal(imp.counts.spending, 2043);
  assert.equal(imp.counts.savingsExcluded, 133);
  assert.equal(imp.counts.transfersExcluded, 160);
  assert.equal(imp.counts.incomeRows, 125);
  assert.equal(imp.counts.skipped, 0);
  assert.equal(imp.monthlyIncome, 70255, 'August 2018 salary');
  assert.equal(imp.originalFirst, '2015-01-01');
  assert.equal(imp.originalLast, '2018-09-20');
  const total = imp.transactions.reduce((s, t) => s + t.amount, 0);
  assert.ok(Math.abs(total - 1573532) < 1, `spending total ${total}`);   // pandas: 1,073,440 + 169,054 + 159,513 + 96,403 + 75,122
  assert.ok(imp.transactions.every(t => ['Bills', 'Food', 'Transport', 'Shopping', 'Entertainment'].includes(t.category)));
  assert.ok(imp.transactions.every(t => t.merchant.length >= 1 && t.merchant.length <= 100));
});

test('the date shift is whole weeks, keeps weekdays and order, and lands in the current week', { skip: !have && 'dataset not present' }, () => {
  const text = fs.readFileSync(CSV, 'utf-8');
  const a = buildKaggleImport(text, 'u1', { now: NOW, shift: false });
  const b = buildKaggleImport(text, 'u1', { now: NOW });
  assert.equal(a.shiftWeeks, 0);
  assert.ok(b.shiftWeeks > 0);
  for (let i = 0; i < a.transactions.length; i += 97) {
    const da = new Date(a.transactions[i].date), db = new Date(b.transactions[i].date);
    assert.equal(db.getTime() - da.getTime(), b.shiftWeeks * 7 * 86400000);
    assert.equal(da.getUTCDay(), db.getUTCDay(), 'same weekday');
    assert.equal(a.transactions[i].amount, b.transactions[i].amount);
  }
  const latest = Math.max(...b.transactions.map(t => new Date(t.date).getTime()));
  assert.ok(latest <= NOW && NOW - latest < 7 * 86400000, 'latest entry within the last week');
});
