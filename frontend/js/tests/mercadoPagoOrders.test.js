const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  buildWebhookManifest,
  normalizeOrderStatusToPedidoStatus,
  normalizeOrderStatusToTransactionStatus,
  parseWebhookSignatureHeader,
  verifyMercadoPagoWebhookSignature
} = require('../services/mercadoPagoOrders');

test('parseWebhookSignatureHeader extracts ts and v1', () => {
  const parsed = parseWebhookSignatureHeader('ts=1712239200,v1=abc123');
  assert.equal(parsed.ts, '1712239200');
  assert.equal(parsed.v1, 'abc123');
});

test('buildWebhookManifest follows Mercado Pago documented template', () => {
  const manifest = buildWebhookManifest({
    dataId: '12345',
    requestId: 'rq-1',
    ts: '1712239200'
  });
  assert.equal(manifest, 'id:12345;request-id:rq-1;ts:1712239200;');
});

test('verifyMercadoPagoWebhookSignature validates expected HMAC', () => {
  const secret = 'test-secret';
  const dataId = '100';
  const requestId = 'req-abc';
  const ts = '1712239200';
  const manifest = buildWebhookManifest({ dataId, requestId, ts });
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const valid = verifyMercadoPagoWebhookSignature({
    xSignature: `ts=${ts},v1=${v1}`,
    xRequestId: requestId,
    dataId,
    secret
  });
  assert.equal(valid, true);
});

test('status mapping keeps internal constraints compatible', () => {
  assert.equal(normalizeOrderStatusToPedidoStatus('processed'), 'pago');
  assert.equal(normalizeOrderStatusToPedidoStatus('cancelled'), 'cancelado');
  assert.equal(normalizeOrderStatusToPedidoStatus('opened'), 'pendente');

  assert.equal(normalizeOrderStatusToTransactionStatus('processed'), 'aprovado');
  assert.equal(normalizeOrderStatusToTransactionStatus('refunded'), 'reembolsado');
  assert.equal(normalizeOrderStatusToTransactionStatus('failed'), 'recusado');
  assert.equal(normalizeOrderStatusToTransactionStatus('created'), 'pendente');
});
