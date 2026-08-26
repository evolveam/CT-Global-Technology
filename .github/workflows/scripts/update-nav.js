const fs = require('fs');
const { chromium } = require('playwright');

const FT_URL = 'https://markets.ft.com/data/funds/tearsheet/historical?s=LU3318823302:USD';
const FILE = 'index.html';

const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
};

function toIso(dateStr) {
  const m = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  const day = String(m[2]).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${m[3]}-${mm}-${day}`;
}

async function fetchHistoricalRows() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(FT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Descartar banner de cookies si aparece, sin fallar si no existe
  try {
    const consentBtn = page.getByRole('button', { name: /accept/i }).first();
    await consentBtn.click({ timeout: 3000 });
  } catch (e) {
    // no había banner, seguimos
  }

  await page.waitForSelector('table', { timeout: 30000 });

  const tables = await page.$$('table');
  let rows = null;
  for (const t of tables) {
    const firstRowText = await t.$eval('tr', tr => tr.textContent).catch(() => '');
    if (/Date/i.test(firstRowText) && /Close/i.test(firstRowText)) {
      rows = await t.$$eval('tr', trs =>
        trs.map(tr => Array.from(tr.querySelectorAll('td,th')).map(td => td.textContent.trim()))
      );
      break;
    }
  }

  await browser.close();

  if (!rows) throw new Error('No se encontro la tabla de precios historicos en la pagina de FT.');
  return rows;
}

async function main() {
  const html = fs.readFileSync(FILE, 'utf8');
  const match = html.match(/var data = (\[[\s\S]*?\]);/);
  if (!match) throw new Error('No se encontro el array "var data = [...]" en index.html');

  const currentData = new Function('return ' + match[1])();
  const lastDate = currentData[currentData.length - 1].d;
  const existingDates = new Set(currentData.map(r => r.d));

  const rows = await fetchHistoricalRows();

  const parsed = [];
  for (const r of rows) {
    if (r.length < 5) continue;
    const iso = toIso(r[0]);
    const close = parseFloat(r[4]);
    if (!iso || Number.isNaN(close)) continue;
    parsed.push({ d: iso, p: Math.round(close * 100) / 100 });
  }

  const newRows = parsed
    .filter(r => r.d > lastDate && !existingDates.has(r.d))
    .sort((a, b) => a.d.localeCompare(b.d));

  if (newRows.length === 0) {
    console.log('Sin cambios: no hay cierre nuevo disponible.');
    return;
  }

  const updatedData = currentData.concat(newRows);
  const arrayText = 'var data = [\n' +
    updatedData.map(r => `    {d:"${r.d}", p:${r.p.toFixed(2)}}`).join(',\n') +
    '\n  ];';

  const newHtml = html.replace(match[0], arrayText);
  fs.writeFileSync(FILE, newHtml);

  console.log('Agregado: ' + newRows.map(r => `${r.d} @ ${r.p.toFixed(2)}`).join(', '));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
