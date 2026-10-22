import type { JobDetail } from './ams.js';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#64': '@' };

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return decode(
    html
      .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href, label) => {
        const h = decode(href).replace(/^mailto:/i, '');
        const l = label.replace(/<[^>]+>/g, '');
        return decode(l).trim() === h ? h : `${l} (${h})`;
      })
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<(br|\/p|\/ul|\/li|ams-heading-\d|\/ams-heading-\d)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Plain-text description with every part of the listing the AI should see. */
export function fullDescription(d: JobDetail): string {
  const loc = d.workingLocation;
  return [
    `Title: ${d.title}`,
    `Company: ${d.company?.name}`,
    `Location: ${[loc?.zipCode, loc?.town, loc?.municipality].filter(Boolean).join(' ')}`,
    `Working time: ${d.workingTime?.description ?? 'unknown'}`,
    d.availableFrom ? `Available from: ${d.availableFrom}` : '',
    d.educationLevels?.length ? `Education levels: ${d.educationLevels.map((e) => e.description).join(', ')}` : '',
    d.drivingLicence ? `Driving licence: ${JSON.stringify(d.drivingLicence)}` : '',
    d.qualifications?.length ? `Qualifications: ${JSON.stringify(d.qualifications)}` : '',
    d.urlToJobOffer ? `External listing: ${d.urlToJobOffer} (${d.jobPortalName ?? ''})` : '',
    d.contact?.email ? `Contact email: ${d.contact.email}` : '',
    d.contact?.phoneNumbers?.length ? `Contact phone: ${JSON.stringify(d.contact.phoneNumbers)}` : '',
    '',
    htmlToText(d.companyIntroduction),
    htmlToText(d.summary),
    htmlToText(d.generalEqualitiyInfo),
  ].filter((l) => l !== '').join('\n');
}

export function findEmails(text: string): string[] {
  const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  return [...new Set(m.map((e) => e.toLowerCase().replace(/\.$/, '')))];
}

export function findPhones(text: string): string[] {
  // Austrian numbers start with 0, +43 or 0043; this skips dates, order numbers and postcodes.
  const m = text.match(/(?<![\d.])(?:\+|0)\d[\d\s/()-]{5,}\d/g) ?? [];
  return [...new Set(m.map((p) => p.trim()).filter((p) => p.replace(/\D/g, '').length >= 8))];
}

export function findUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s)"'<>]+/gi) ?? [])];
}

/** Austrian number → wa.me digits (e.g. "0676 / 884 88 215" → "4367688488215"). */
export function waNumber(phone: string): string | null {
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '43' + d.slice(1);
  else return null;
  return d.length >= 10 ? d : null;
}

export function waLink(phone: string, title: string, name: string): string | null {
  const n = waNumber(phone);
  if (!n) return null;
  const msg = `Guten Tag, ich habe Ihre Stellenanzeige "${title}" auf jobs.ams.at gesehen und interessiere mich sehr dafür. ` +
    `Ist die Stelle noch frei? / Hello, I saw your job ad "${title}" on jobs.ams.at and I'm very interested. Is it still available? ` +
    `Mit freundlichen Grüßen, ${name}`;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
}
