import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { Profile } from './profile.js';

/** Render a simple one-page German cover letter PDF; returns its path. */
export async function writeCoverLetter(opts: { profile: Profile; company: string; title: string; reference: string | null; body: string; jobId: number }): Promise<string> {
  mkdirSync(config.outDir, { recursive: true });
  const file = path.join(config.outDir, `Anschreiben_${opts.jobId}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 64 });
  const done = new Promise<void>((resolve, reject) => {
    const out = createWriteStream(file);
    out.on('finish', resolve).on('error', reject);
    doc.pipe(out);
  });

  const p = opts.profile;
  doc.font('Helvetica-Bold').fontSize(13).text(p.name);
  doc.font('Helvetica').fontSize(10).text([`${config.city}, ${p.area}`, p.phone, p.email].filter((s) => s && !s.startsWith('[')).join('  ·  '));
  doc.moveDown(2);
  doc.fontSize(11).text(opts.company);
  doc.moveDown();
  doc.text(`${config.city}, ${new Date().toLocaleDateString('de-AT')}`, { align: 'right' });
  doc.moveDown();
  doc.font('Helvetica-Bold').text(`Bewerbung als ${opts.title}${opts.reference ? ` (Ref.-Nr. ${opts.reference})` : ''}`);
  doc.moveDown();
  doc.font('Helvetica').text(opts.body, { align: 'justify', lineGap: 2 });
  doc.moveDown(1.5);
  doc.text('Mit freundlichen Grüßen');
  doc.moveDown(0.5);
  doc.text(p.name);
  doc.end();
  await done;
  return file;
}
