const crypto = require('crypto');
const { MercadoPagoConfig, Order } = require('mercadopago');

function createOrderClient(accessToken) {
  if (!accessToken) {
    throw new Error('MERCADO_PAGO_ACCESS_TOKEN nao configurado.');
  }

  const client = new MercadoPagoConfig({ accessToken });
  return new Order(client);
}

function createIdempotencyKey() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function toAmountString(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error('Valor invalido para monetizacao.');
  }
  return numeric.toFixed(2);
}

function normalizeOrderStatusToTransactionStatus(orderStatus) {
  const status = String(orderStatus || '').toLowerCase();

  if (['processed', 'approved', 'paid', 'completed'].includes(status)) {
    return 'aprovado';
  }
  if (['cancelled', 'canceled'].includes(status)) {
    return 'cancelado';
  }
  if (['refunded', 'charged_back'].includes(status)) {
    return 'reembolsado';
  }
  if (['failed', 'rejected'].includes(status)) {
    return 'recusado';
  }

  return 'pendente';
}

function normalizeOrderStatusToPedidoStatus(orderStatus) {
  const status = String(orderStatus || '').toLowerCase();

  if (['processed', 'approved', 'paid', 'completed'].includes(status)) {
    return 'pago';
  }
  if (['cancelled', 'canceled'].includes(status)) {
    return 'cancelado';
  }

  return 'pendente';
}

function sanitizeMercadoError(error) {
  if (!error) {
    return { message: 'Erro desconhecido.' };
  }

  const fallbackMessage = typeof error.message === 'string' ? error.message : 'Erro na comunicacao com Mercado Pago.';
  const apiResponse = error.cause || error.response || null;

  return {
    message: fallbackMessage,
    status: apiResponse?.status || null,
    statusText: apiResponse?.statusText || null,
    id: apiResponse?.id || null,
    errors: Array.isArray(apiResponse?.cause) ? apiResponse.cause : []
  };
}

function parseWebhookSignatureHeader(xSignature) {
  if (!xSignature || typeof xSignature !== 'string') {
    return { ts: null, v1: null };
  }

  const parsed = { ts: null, v1: null };
  const parts = xSignature.split(',');

  for (const part of parts) {
    const [keyRaw, valueRaw] = part.split('=', 2);
    const key = String(keyRaw || '').trim().toLowerCase();
    const value = String(valueRaw || '').trim();

    if (key === 'ts') parsed.ts = value;
    if (key === 'v1') parsed.v1 = value;
  }

  return parsed;
}

function buildWebhookManifest({ dataId, requestId, ts }) {
  // Manifest template documented in Mercado Pago webhook signature verification docs:
  // id:[data.id];request-id:[x-request-id];ts:[ts];
  const chunks = [];
  if (dataId) chunks.push(`id:${dataId};`);
  if (requestId) chunks.push(`request-id:${requestId};`);
  if (ts) chunks.push(`ts:${ts};`);
  return chunks.join('');
}

function verifyMercadoPagoWebhookSignature({ xSignature, xRequestId, dataId, secret }) {
  if (!secret) return false;

  const { ts, v1 } = parseWebhookSignatureHeader(xSignature);
  if (!v1) return false;

  const manifest = buildWebhookManifest({
    dataId: String(dataId || ''),
    requestId: String(xRequestId || ''),
    ts
  });

  if (!manifest) return false;

  const generated = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  const generatedBuffer = Buffer.from(generated, 'utf8');
  const receivedBuffer = Buffer.from(v1, 'utf8');
  if (generatedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(generatedBuffer, receivedBuffer);
}

module.exports = {
  buildWebhookManifest,
  createIdempotencyKey,
  createOrderClient,
  normalizeOrderStatusToPedidoStatus,
  normalizeOrderStatusToTransactionStatus,
  parseWebhookSignatureHeader,
  sanitizeMercadoError,
  toAmountString,
  verifyMercadoPagoWebhookSignature
};
