// Parse an uploaded data sheet (.xlsx / .xls / .csv) into an array of row objects
// keyed by the header row, e.g. { email: 'jane@acme.com', first_name: 'Jane' }.
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';

// exceljs cells can be plain values or objects (hyperlink, rich text, formula).
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    if (v.hyperlink) return String(v.hyperlink);
    if (v.richText) return v.richText.map((r) => r.text).join('');
    return '';
  }
  return String(v);
}

async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headers = (ws.getRow(1).values || []).slice(1).map((h) => cellText(h).trim());
  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = (row.values || []).slice(1);
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = cellText(values[i]).trim();
    });
    if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
  });
  return rows;
}

export async function parseSpreadsheet(buffer, filename = '') {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') {
    return parseCsv(buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
  }
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    return parseXlsx(buffer);
  }
  // No/unknown extension: try Excel first (it's a zip; throws on plain text), then CSV.
  try {
    return await parseXlsx(buffer);
  } catch {
    return parseCsv(buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
  }
}
