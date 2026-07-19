const https = require('https');

const DAILY_API_BASE = 'https://api.daily.co/v1';

function dailyRequest({ path, method = 'GET', apiKey, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const req = https.request(
      `${DAILY_API_BASE}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        },
        timeout: 12000
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8') || '{}';
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (_error) {
            return reject(new Error('Daily.co retornou resposta inválida.'));
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(parsed?.error || parsed?.info || `Daily.co HTTP ${res.statusCode}`));
          }

          return resolve(parsed);
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('Timeout ao acessar Daily.co')));
    req.on('error', (error) => reject(error));
    if (payload) req.write(payload);
    req.end();
  });
}

async function listRooms(apiKey) {
  return dailyRequest({ path: '/rooms', method: 'GET', apiKey });
}

async function createRoom(apiKey, room) {
  return dailyRequest({ path: '/rooms', method: 'POST', apiKey, body: room });
}

async function createMeetingToken(apiKey, roomName, tokenConfig) {
  return dailyRequest({
    path: '/meeting-tokens',
    method: 'POST',
    apiKey,
    body: {
      room_name: roomName,
      ...tokenConfig
    }
  });
}

module.exports = {
  listRooms,
  createRoom,
  createMeetingToken
};
