import ExcelJS from 'exceljs';
import { config } from './config.js';
import { allManualJobs } from './db.js';

/** Rebuild external_jobs.xlsx from every manual job in the database (newest first). */
export async function writeExternalJobs(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Manual applications');
  ws.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Title', key: 'title', width: 38 },
    { header: 'Company', key: 'company', width: 30 },
    { header: 'Method', key: 'method', width: 10 },
    { header: 'Apply link / phone', key: 'target', width: 45 },
    { header: 'WhatsApp', key: 'wa', width: 14 },
    { header: 'AMS listing', key: 'link', width: 14 },
    { header: 'Why it fits', key: 'reason', width: 70 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const j of allManualJobs()) {
    const target = j.apply_target ?? '';
    const row = ws.addRow({
      date: j.created_at.slice(0, 10),
      title: j.title,
      company: j.company,
      method: j.apply_method,
      target: /^https?:/.test(target) ? { text: target, hyperlink: target } : target,
      wa: j.wa_link ? { text: 'Open chat', hyperlink: j.wa_link } : '',
      link: { text: 'Open', hyperlink: j.link },
      reason: j.reason,
    });
    row.alignment = { vertical: 'top', wrapText: true };
  }
  ws.autoFilter = { from: 'A1', to: 'H1' };
  await wb.xlsx.writeFile(config.excelPath);
  return config.excelPath;
}
