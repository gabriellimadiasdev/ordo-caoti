const REPORT_TYPES = Object.freeze({
  RELEASES: 'releases',
  ACCOUNT_BALANCE_SETTLEMENT: 'account_balance_settlement',
  BILLING: 'billing',
  SPLIT_SALES: 'split_sales'
});

const VERIFIED_REPORT_ENDPOINTS = Object.freeze({
  // Official reference: Releases report create endpoint.
  // https://www.mercadopago.com.ar/developers/en/reference/releases-report/create-report/post
  [REPORT_TYPES.RELEASES]: '/v1/account/release_report'
});

function parseDateInput(input) {
  const date = input instanceof Date ? input : new Date(String(input || ''));
  if (Number.isNaN(date.getTime())) {
    throw new Error('Data invalida.');
  }
  return date;
}

function toUtcIsoBoundary(date, boundary) {
  const d = new Date(date.getTime());
  if (boundary === 'start') {
    d.setUTCHours(0, 0, 0, 0);
  } else {
    d.setUTCHours(23, 59, 59, 0);
  }
  return d.toISOString().replace('.000Z', 'Z');
}

function buildValidatedDateRange(beginDate, endDate) {
  const begin = parseDateInput(beginDate);
  const end = parseDateInput(endDate);

  if (begin > end) {
    throw new Error('begin_date deve ser anterior a end_date.');
  }

  const diffMs = end.getTime() - begin.getTime();
  const maxMs = 60 * 24 * 60 * 60 * 1000;
  if (diffMs > maxMs) {
    throw new Error('Intervalo maximo permitido: 60 dias.');
  }

  return {
    begin_date: toUtcIsoBoundary(begin, 'start'),
    end_date: toUtcIsoBoundary(end, 'end')
  };
}

class MercadoPagoReportsClient {
  constructor({ accessToken, baseUrl = 'https://api.mercadopago.com' } = {}) {
    if (!accessToken) {
      throw new Error('MERCADO_PAGO_ACCESS_TOKEN nao configurado.');
    }
    this.accessToken = accessToken;
    this.baseUrl = baseUrl;
  }

  async createReport({ reportType, beginDate, endDate, extraBody = {}, fetchImpl = global.fetch }) {
    if (!fetchImpl) {
      throw new Error('fetch nao disponivel neste runtime.');
    }

    const endpoint = VERIFIED_REPORT_ENDPOINTS[reportType];
    if (!endpoint) {
      throw new Error(
        `Tipo de relatorio "${reportType}" sem endpoint confirmado neste projeto. ` +
        'Valide o endpoint no Mercado Pago Developers antes de habilitar este tipo.'
      );
    }

    const range = buildValidatedDateRange(beginDate, endDate);
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...range,
        ...extraBody
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error('Falha ao gerar relatorio Mercado Pago.');
      err.status = response.status;
      err.details = data;
      throw err;
    }

    return data;
  }
}

module.exports = {
  MercadoPagoReportsClient,
  REPORT_TYPES,
  buildValidatedDateRange
};
