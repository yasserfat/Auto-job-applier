import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { config } from './config.js';
import { log } from './log.js';
import { profileText, type Profile } from './profile.js';

export const ReviewSchema = z.object({
  suitable: z.boolean(),
  reason: z.string().describe('One sentence explaining the decision'),
  apply_method: z.enum(['email', 'external', 'phone', 'unclear']),
  applies_by_email_explicitly: z.boolean()
    .describe('true only if the listing itself asks applicants to send their application/CV by email'),
  apply_email: z.string().nullable(),
  apply_url: z.string().nullable(),
  apply_phone: z.string().nullable(),
  contact_person: z.string().nullable(),
  reference_number: z.string().nullable(),
  required_documents: z.array(z.string()),
  cover_letter_required: z.boolean(),
  application_email: z.object({ subject: z.string(), body: z.string() }),
  cover_letter: z.string().nullable().describe('German cover letter text, only when cover_letter_required is true'),
});
export type Review = z.infer<typeof ReviewSchema>;

const client = new Anthropic({ apiKey: config.anthropicApiKey });

function systemPrompt(profile: Profile): string {
  return `You review Austrian job listings from jobs.ams.at for a student and prepare applications.

## Applicant profile
${profileText(profile)}

## Decide "suitable"
Mark suitable=false if ANY of these is true:
- The job requires fluent or very good German (e.g. "fließend", "sehr gute Deutschkenntnisse", "verhandlungssicher", "perfekt", "Muttersprache"). Basic or "gute" German for back-of-house work (cleaning, kitchen, dishwashing, warehouse) is acceptable, but mention it in the reason.
- A driving licence (Führerschein/FSB) or own car is required. "Von Vorteil" (an advantage) does not count as required.
- A completed apprenticeship (abgeschlossene Lehre, LAP), professional training or a certificate the applicant doesn't have is required.
- The job is full-time only, or needs more hours than the applicant's maximum, or clearly conflicts with the availability.
- It is a leadership, skilled-trade (Koch/Köchin, Elektriker…), driving, care/nursing or apprenticeship (Lehrstelle) position.
Otherwise, if it is entry-level work the applicant can do (cleaning, kitchen help, dishwashing, office/admin help, warehouse, retail helper, hotel service/housekeeping), mark suitable=true.

## Decide "apply_method"
- "email": the listing asks applicants to send their application/CV/Unterlagen to an email address. If it offers both an online form and email, choose "email".
- "external": apply only via a website, online form or job portal link.
- "phone": the listing only asks to call (or WhatsApp) a number.
- "unclear": none of the above is stated.
Copy apply_email, apply_url and apply_phone exactly as they appear in the listing (null if absent). Never invent an address.
reference_number: any Referenznummer/Kennziffer/Auftragsnummer/Job-ID the listing asks to quote, else null. AMS pre-selection listings ("Das AMS ... übernimmt die Vorauswahl") ask to send the application to an AMS advisor's email with the Auftragsnummer in the subject: that is apply_method "email".
required_documents: documents the listing asks for (e.g. "Lebenslauf", "Motivationsschreiben", "Zeugnisse", "Foto").
cover_letter_required: true if a Motivationsschreiben/Anschreiben/Bewerbungsschreiben/cover letter is requested.

## Truthfulness (applies to application_email and cover_letter)
Use ONLY facts from the applicant profile. Never invent skills, references, praise from colleagues, German level, availability or working days. If a profile field is still a placeholder in [square brackets], leave that topic out instead of guessing.

## application_email (always fill, even if unsuitable)
- subject: German, e.g. "Bewerbung als <Jobtitel>" plus the reference number if given.
- body: polite German, 4-6 sentences. Start with "Sehr geehrte Damen und Herren," (or "Sehr geehrte/r Frau/Herr <Name>," if a contact person is named). Mention the job title, the company, the reference number if given, the applicant's availability and the most relevant experience. Mention the applicant's status (e.g. student). If the applicant's German is not fluent, say they are currently learning German (e.g. "Ich lerne derzeit Deutsch"), but NEVER state their German level (no "A1", "Anfänger", "Grundkenntnisse" or any CEFR level). Say the CV is attached. Do NOT add a closing greeting or signature; that is appended automatically.
## cover_letter
Only when cover_letter_required: a short German cover letter body (8-12 sentences, no address block, no signature). Same German rule: if the applicant's German is not fluent, say they are learning German, never state the level. Otherwise null.`;
}

async function callOnce(profile: Profile, description: string): Promise<Review> {
  const res = await client.messages.parse({
    model: config.aiModel,
    max_tokens: 4000,
    system: systemPrompt(profile),
    messages: [{ role: 'user', content: `Job listing:\n\n${description}` }],
    output_config: { format: zodOutputFormat(ReviewSchema) },
  });
  if (res.stop_reason === 'max_tokens') throw new Error('AI response was cut off (max_tokens)');
  if (res.stop_reason === 'refusal') throw new Error('AI refused to review this listing');
  // parse() already validated against the schema; re-check so a null result surfaces as an error.
  const review = ReviewSchema.parse(res.parsed_output);
  const letters = `${review.application_email.body}\n${review.cover_letter ?? ''}`;
  if (GERMAN_LEVEL.test(letters)) throw new Error('Application text states the German level');
  return review;
}

/** The applications must say "learning German" without naming a level. */
const GERMAN_LEVEL = /\b[ABC][12]\b|Niveau|Anfänger|Grundkenntnisse/i;

/** Review a job; retries once when the response is missing or fails schema validation. */
export async function reviewJob(profile: Profile, description: string): Promise<Review> {
  try {
    return await callOnce(profile, description);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw e;
    log.warn('AI review invalid, retrying once:', (e as Error).message);
    return await callOnce(profile, description);
  }
}
