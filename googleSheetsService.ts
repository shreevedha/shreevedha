const DEFAULT_SPREADSHEET_ID = process.env.CERTIFICATES_SPREADSHEET_ID || '1492QcISXmPMmBFO9s8ebdnuEt17JEoz5v0rmj3GN7A8';

let cachedSheetCerts: any[] = [];
let lastFetchTimestamp = 0;
const CACHE_TTL_MS = 20 * 1000; // 20-second cache for instant verification and low latency

function normalizeHeader(h: string): string {
  const clean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean.includes('cert') && (clean.includes('id') || clean.includes('code') || clean.includes('no') || clean.includes('num'))) return 'certificate_id';
  if (clean.includes('student') || clean.includes('candidat') || clean === 'fullname' || clean === 'name') return 'student_name';
  if (clean.includes('reg') || clean.includes('roll')) return 'reg_no';
  if (clean.includes('qual') || clean.includes('degree') || clean.includes('branch')) return 'qualification';
  if (clean.includes('college') || clean.includes('inst')) return 'college_name';
  if (clean.includes('course') || clean.includes('program') || clean.includes('title')) return 'course_title';
  if (clean.includes('type')) return 'certificate_type';
  if (clean.includes('duration') || clean.includes('period') || clean.includes('days')) return 'duration';
  if (clean === 'mode' || clean.includes('trainingmode')) return 'mode';
  if (clean.includes('status') || clean.includes('grade')) return 'certification_status';
  if (clean.includes('skill')) return 'skill_areas';
  if (clean.includes('org') || clean.includes('issuing')) return 'issuing_organization';
  if (clean.includes('date')) return 'issue_date';
  return clean;
}

function parseCSV(text: string): any[] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(current.trim());
      if (row.some(c => c.length > 0)) lines.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }
  if (current || row.length > 0) {
    row.push(current.trim());
    if (row.some(c => c.length > 0)) lines.push(row);
  }
  if (lines.length < 2) return [];

  const headers = lines[0].map(normalizeHeader);
  const results: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const r = lines[i];
    const obj: any = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = r[idx] || '';
    });

    if (obj.certificate_id || obj.student_name) {
      if (!obj.roll_no && obj.reg_no) obj.roll_no = obj.reg_no;
      if (!obj.reg_no && obj.roll_no) obj.reg_no = obj.roll_no;
      if (!obj.certificate_code && obj.certificate_id) obj.certificate_code = obj.certificate_id;
      if (!obj.certificate_id && obj.certificate_code) obj.certificate_id = obj.certificate_code;
      if (!obj.grade && obj.certification_status) obj.grade = obj.certification_status;
      if (!obj.certification_status && obj.grade) obj.certification_status = obj.grade;
      if (!obj.issuing_organization) obj.issuing_organization = 'Shreevedha Solutions India Pvt Ltd';
      if (!obj.certificate_type) obj.certificate_type = 'Certificate of Completion';

      results.push(obj);
    }
  }

  return results;
}

export async function getCertificatesFromGoogleSheet(sheetId = DEFAULT_SPREADSHEET_ID): Promise<any[]> {
  const now = Date.now();
  if (cachedSheetCerts.length > 0 && now - lastFetchTimestamp < CACHE_TTL_MS) {
    return cachedSheetCerts;
  }

  try {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) {
      console.warn(`Google Sheet CSV export returned status: ${resp.status}`);
      return cachedSheetCerts;
    }

    const csvText = await resp.text();
    if (!csvText || !csvText.trim()) {
      return cachedSheetCerts;
    }

    const parsed = parseCSV(csvText);
    if (parsed.length > 0) {
      cachedSheetCerts = parsed;
      lastFetchTimestamp = now;
      console.log(`Loaded ${parsed.length} certificates live from Google Sheet.`);
    }

    return parsed.length > 0 ? parsed : cachedSheetCerts;
  } catch (err: any) {
    console.warn('Failed to load certificates from Google Sheet:', err?.message || err);
    return cachedSheetCerts;
  }
}
