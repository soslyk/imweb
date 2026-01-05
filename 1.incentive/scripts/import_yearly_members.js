/* eslint-disable no-console */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DEFAULT_ENV_PATH = path.resolve(__dirname, '..', '.env');

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      return;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

loadEnvFile(DEFAULT_ENV_PATH);

const DATA_URLS = {
  2024: process.env.CSV_URL_2024 || '',
  2025: process.env.CSV_URL_2025 || '',
  2026: process.env.CSV_URL_2026 || ''
};

const DB_CONFIG = {
  host: process.env.DB_HOST || '',
  port: Number(process.env.DB_PORT || ''),
  database: process.env.DB_NAME || '',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || ''
};

const BATCH_SIZE = 500;

function ensureFetch() {
  if (typeof fetch === 'function') {
    return fetch;
  }
  throw new Error('Node 18+ 환경이 필요합니다. (fetch 사용)');
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

function normalizeDate(raw) {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  const noWeekday = trimmed.replace(/\(.*\)$/, '').trim();
  const dashed = noWeekday.includes('.') ? noWeekday.replace(/\./g, '-') : noWeekday;
  return dashed;
}

function parseCsvToRows(csvText) {
  const text = csvText.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return [];
  }
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const branchNames = headers.slice(1).filter((name) => name);

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const dateRaw = values[0];
    const date = normalizeDate(dateRaw);
    if (!date) {
      continue;
    }
    branchNames.forEach((branch, index) => {
      const rawValue = (values[index + 1] || '').trim();
      if (rawValue === '') {
        return;
      }
      const numeric = Number(rawValue.replace(/,/g, ''));
      if (Number.isNaN(numeric)) {
        return;
      }
      rows.push({
        date,
        branch,
        count: numeric
      });
    });
  }
  return rows;
}

async function fetchYearData(year, url) {
  const fetchImpl = ensureFetch();
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`[${year}] CSV 다운로드 실패: ${response.status}`);
  }
  const csvText = await response.text();
  return parseCsvToRows(csvText);
}

async function upsertRows(client, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = batch.map((row, index) => {
      const base = index * 3;
      values.push(row.date, row.branch, row.count);
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    });

    const query = `
      INSERT INTO yearlymembers.yearly_member_counts (date, branch, count)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (date, branch)
      DO UPDATE SET count = EXCLUDED.count, updated_at = NOW()
    `;
    await client.query(query, values);
  }
}

async function run() {
  if (!DB_CONFIG.password) {
    throw new Error('DB_PASSWORD 환경변수가 필요합니다.');
  }
  if (!DB_CONFIG.host || !DB_CONFIG.port || !DB_CONFIG.database || !DB_CONFIG.user) {
    throw new Error('DB_HOST, DB_PORT, DB_NAME, DB_USER 환경변수가 필요합니다.');
  }
  const missingUrls = Object.entries(DATA_URLS)
    .filter(([, url]) => !url)
    .map(([year]) => year);
  if (missingUrls.length > 0) {
    throw new Error(`CSV_URL_YYYY 환경변수가 비어 있습니다: ${missingUrls.join(', ')}`);
  }
  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const [year, url] of Object.entries(DATA_URLS)) {
      const rows = await fetchYearData(year, url);
      await upsertRows(client, rows);
      console.log(`[완료] ${year}년 ${rows.length}건 적재`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error('[오류]', error.message);
  process.exitCode = 1;
});
