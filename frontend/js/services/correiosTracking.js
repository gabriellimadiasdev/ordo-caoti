const https = require('https');

const BRASIL_API_TIMEOUT_MS = 7000;

function normalizeTrackingCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isTrackingCodeValid(code) {
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code);
}

function fetchJson(url, timeoutMs = BRASIL_API_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 250)}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error('Resposta JSON invalida do provedor de rastreio.'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Timeout ao consultar rastreio.'));
    });

    req.on('error', (error) => reject(error));
  });
}

async function fetchCorreiosTracking(code) {
  const codigo = normalizeTrackingCode(code);
  if (!isTrackingCodeValid(codigo)) {
    const error = new Error('Codigo de rastreio invalido. Formato esperado: AA123456789BR.');
    error.statusCode = 400;
    throw error;
  }

  const brasilApiUrl = `https://brasilapi.com.br/api/correios/v1/${codigo}`;
  const response = await fetchJson(brasilApiUrl);

  return {
    provider: 'brasilapi-correios',
    codigo,
    servico: response.service || null,
    prazo: response.time || null,
    cidade: response.city || null,
    estado: response.state || null,
    eventos: Array.isArray(response.tracking) ? response.tracking : [],
    raw: response
  };
}

module.exports = {
  normalizeTrackingCode,
  isTrackingCodeValid,
  fetchCorreiosTracking
};
