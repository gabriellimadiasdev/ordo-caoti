const { MercadoPagoReportsClient, REPORT_TYPES } = require('../services/mercadoPagoReports');

async function main() {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const beginDate = process.argv[2];
  const endDate = process.argv[3];

  if (!beginDate || !endDate) {
    console.error('Uso: node backend/js/scripts/generate-releases-report.js <begin_date> <end_date>');
    process.exit(1);
  }

  const client = new MercadoPagoReportsClient({ accessToken });
  const result = await client.createReport({
    reportType: REPORT_TYPES.RELEASES,
    beginDate,
    endDate
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const status = error?.status ? ` (status ${error.status})` : '';
  console.error(`Erro ao gerar relatorio${status}: ${error.message}`);
  if (error?.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exit(1);
});
