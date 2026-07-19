const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildValidatedDateRange,
  MercadoPagoReportsClient,
  REPORT_TYPES
} = require('../services/mercadoPagoReports');

test('buildValidatedDateRange normalizes begin/end boundaries to ISO UTC', () => {
  const range = buildValidatedDateRange('2026-03-01', '2026-03-15');
  assert.equal(range.begin_date, '2026-03-01T00:00:00Z');
  assert.equal(range.end_date, '2026-03-15T23:59:59Z');
});

test('buildValidatedDateRange rejects periods longer than 60 days', () => {
  assert.throws(
    () => buildValidatedDateRange('2026-01-01', '2026-04-05'),
    /60 dias/
  );
});

test('MercadoPagoReportsClient blocks report types without verified endpoint', async () => {
  const client = new MercadoPagoReportsClient({ accessToken: 'test-token' });

  await assert.rejects(
    () => client.createReport({
      reportType: REPORT_TYPES.BILLING,
      beginDate: '2026-03-01',
      endDate: '2026-03-15',
      fetchImpl: async () => ({ ok: true, json: async () => ({}) })
    }),
    /endpoint confirmado/
  );
});
