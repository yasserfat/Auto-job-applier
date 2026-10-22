import { existsSync, readFileSync } from 'node:fs';
import { config } from './config.js';

export type Profile = {
  name: string;
  status: string;
  languages: Record<string, string>;
  experience: string[];
  availability: string;
  maxHoursPerWeek: string | number;
  phone: string;
  email: string;
  area: string;
  notes?: string;
};

export function loadProfile(): Profile {
  if (!existsSync(config.profilePath)) throw new Error('config/profile.json not found: copy config/profile.example.json to config/profile.json and fill it in');
  const p = JSON.parse(readFileSync(config.profilePath, 'utf8')) as Profile;
  // Applications are sent from GMAIL_USER, so that is the natural contact email.
  if (!p.email || /^\s*\[.*\]\s*$/.test(p.email)) p.email = config.gmailUser;
  return p;
}

/** Fields still containing "[...]" placeholders. Live sending is blocked while any remain. */
export function unfilledFields(p: Profile): string[] {
  return Object.entries(p)
    .filter(([, v]) => typeof v === 'string' && /^\s*\[.*\]\s*$/.test(v))
    .map(([k]) => k);
}

export function profileText(p: Profile): string {
  return [
    `Name: ${p.name}`,
    `Status: ${p.status}`,
    `Languages: ${Object.entries(p.languages).map(([l, lvl]) => `${l} (${lvl})`).join(', ')}`,
    `Experience: ${p.experience.join('; ')}`,
    `Availability: ${p.availability}`,
    `Max hours per week: ${p.maxHoursPerWeek}`,
    `Lives in: Salzburg, ${p.area}`,
    `Phone: ${p.phone}`,
    `Email: ${p.email}`,
    p.notes ? `Notes: ${p.notes}` : '',
  ].filter(Boolean).join('\n');
}
