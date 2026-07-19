async function main() {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const country = process.argv[2] || 'MLB';
  const profile = process.argv[3] || 'seller';
  const reference = process.argv[4] || 'ordo-caoti-test-user';
  const initialBalance = process.argv[5] || null;

  if (!accessToken) {
    throw new Error('MERCADO_PAGO_ACCESS_TOKEN nao configurado.');
  }

  const payload = {
    site_id: country,
    description: profile
  };

  const response = await fetch('https://api.mercadopago.com/users/test_user', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(`Falha ao criar usuario de teste: HTTP ${response.status}`);
    err.details = data;
    throw err;
  }

  const result = {
    reference,
    country,
    profile,
    initial_balance_requested: initialBalance,
    note:
      'O endpoint oficial de criacao de test user deve ser validado no painel Developers para confirmar suporte a saldo inicial.',
    user: data
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  if (error.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exit(1);
});
