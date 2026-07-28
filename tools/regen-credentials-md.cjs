// tools/regen-credentials-md.cjs
//
// Re-render bulk_member_passwords.md from the canonical sources of truth:
//
//   - bulk_members_template.csv   — service_number, rank, name (the roster)
//   - __seed_realrun.json         — the Edge Function response. Each entry
//                                   has { service_number, email,
//                                   temp_password, placeholder_email }.
//
// Joins by service_number (NOT by row order — that was the bug that
// produced the off-by-one md earlier). Writes to bulk_member_passwords.md
// by default, with --out to override and --dry-run to print to stdout.
//
// The md file is gitignored because it contains plaintext temp PINs. Do
// not commit it. After distributing slips, destroy (or securely store)
// the file — the bcrypt hashes in auth.users are the only durable record
// of each PIN.
//
// Usage:
//   node tools/regen-credentials-md.cjs                    # write md (default path)
//   node tools/regen-credentials-md.cjs --dry-run          # print to stdout, no write
//   node tools/regen-credentials-md.cjs --out other.md      # write a different path
//   node tools/regen-credentials-md.cjs --json other.json  # override seed-response path
//   node tools/regen-credentials-md.cjs --csv other.csv    # override roster path

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flags = {};
for (const a of args) {
  if (a === '--dry-run') flags.dryRun = true;
  else if (a === '--out' || a === '--json' || a === '--csv') {
    const i = args.indexOf(a);
    flags[a.replace(/^--/, '')] = args[i + 1];
  } else if (a.startsWith('--out=')) flags.out = a.slice('--out='.length);
  else if (a.startsWith('--json=')) flags.json = a.slice('--json='.length);
  else if (a.startsWith('--csv=')) flags.csv = a.slice('--csv='.length);
  else if (a === '-h' || a === '--help') {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').match(/\/\/ Usage:[\s\S]*$/m)[0]);
    process.exit(0);
  }
}

const ROOT = path.resolve(__dirname, '..');
const csvPath = path.resolve(ROOT, flags.csv || 'bulk_members_template.csv');
const jsonPath = path.resolve(ROOT, flags.json || '__seed_realrun.json');
const outPath = path.resolve(ROOT, flags.out || 'bulk_member_passwords.md');

function parseCsv(text) {
  // Minimal RFC-4180-ish CSV parser. Handles quoted fields with embedded
  // commas; we don't expect newlines in this roster.
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

function loadRoster() {
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(`Roster CSV looks empty: ${csvPath}`);
  const header = rows[0].map((h) => h.trim());
  const idx = {
    service_number: header.indexOf('service_number'),
    rank: header.indexOf('rank'),
    name: header.indexOf('name'),
  };
  for (const [k, v] of Object.entries(idx)) if (v < 0) throw new Error(`CSV missing column: ${k}`);
  return rows.slice(1).map((r) => ({
    service_number: r[idx.service_number].trim(),
    rank: (r[idx.rank] || '').trim(),
    name: (r[idx.name] || '').trim(),
  }));
}

function loadCredentials() {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Missing seed JSON: ${jsonPath}. Run the bulk-seed-members Edge Function first.`);
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const list = Array.isArray(data.credentials) ? data.credentials : [];
  const bySvc = new Map();
  for (const c of list) bySvc.set(String(c.service_number), c);
  return bySvc;
}

function renderMd(roster, bySvc, generated) {
  const lines = [];
  lines.push('# MMMIS bulk-member seed — temporary credentials');
  lines.push('');
  lines.push(`Generated: ${generated}`);
  lines.push('Project: gkegnmshivmgqhenqkzr.supabase.co');
  lines.push('');
  const seeded = roster.filter((r) => bySvc.has(r.service_number));
  const skipped = roster.filter((r) => !bySvc.has(r.service_number));
  lines.push(
    `**${seeded.length} of ${roster.length} staging members were seeded.** ` +
    (skipped.length
      ? `The ${skipped.length} skipped were ${skipped.map((r) => r.service_number).join(', ')} — ` +
        'rows for them already existed in public.users (partial unique index from migration 0020 blocked the insert).'
      : 'All staging members were newly seeded.')
  );
  lines.push('');
  lines.push(
    'Members can sign in at https://mmmis.vercel.app/login with their service number and the temporary PIN below. ' +
    'They will be prompted to change the PIN on first sign-in.'
  );
  lines.push('');
  lines.push(
    'All passwords are placeholders. Real member emails should be set from /portal/profile ' +
    '(or via the set-member-email Edge Function). Each row below shows the placeholder email used for auth.users.email.'
  );
  lines.push('');
  lines.push('## Newly seeded members');
  lines.push('');
  lines.push('| Service # | Rank | Name | Placeholder email | Temp PIN |');
  lines.push('|-----------|------|------|-------------------|----------|');
  for (const r of seeded) {
    const c = bySvc.get(r.service_number);
    lines.push(
      `| ${r.service_number.padEnd(7)} | ${(r.rank || '').padEnd(6)} | ${r.name.padEnd(18)} | ${c.email.padEnd(19)} | ${c.temp_password} |`
    );
  }
  lines.push('');
  lines.push('## IMPORTANT');
  lines.push('');
  lines.push(
    'The Temp PIN column above has been populated with real 16-character passwords generated by the Edge Function. ' +
    'They are NOT recoverable from Supabase. Once this file is destroyed, the only way to grant access is via the ' +
    'Supabase reset-password flow — so copy the PINs onto slips first, then destroy this file.'
  );
  lines.push('');
  lines.push('A working copy of the raw JSON lives at `__seed_realrun.json` (also gitignored) if you want to re-render this file later.');
  lines.push('');
  if (skipped.length) {
    lines.push('## Pre-existing (skipped by seed)');
    lines.push('');
    lines.push('| Service # | Rank | Name | Notes |');
    lines.push('|-----------|------|------|-------|');
    for (const r of skipped) {
      lines.push(`| ${r.service_number.padEnd(7)} | ${(r.rank || '').padEnd(6)} | ${r.name.padEnd(18)} | already in public.users |`);
    }
    lines.push('');
  }
  lines.push('## Roll-forward');
  lines.push('');
  lines.push('1. Sign in to https://mmmis.vercel.app/login with each service number + temporary PIN.');
  lines.push('2. Each member should change their PIN on first sign-in (forced).');
  lines.push('3. Each member should set their real email from /portal/profile so password-recovery flows work.');
  lines.push('   The placeholder email shown in the table is what auth currently has on file; clients');
  lines.push("   resolve it from service_number via the lookup_email_by_service_number RPC.");
  lines.push('4. Print and physically destroy (or securely store) the credentials file once slips have been');
  lines.push('   distributed. Do not commit it to git (already in .gitignore).');
  lines.push('');
  return lines.join('\r\n');
}

function main() {
  const roster = loadRoster();
  const bySvc = loadCredentials();
  const generated = new Date().toISOString().slice(0, 10);

  // Sanity: warn on PIN collisions (would be a sign the JSON is broken).
  const pins = new Map();
  for (const c of bySvc.values()) {
    if (pins.has(c.temp_password)) {
      process.stderr.write(`WARN: duplicate PIN ${c.temp_password} on ${pins.get(c.temp_password).service_number} and ${c.service_number}\n`);
    } else {
      pins.set(c.temp_password, c);
    }
  }

  const md = renderMd(roster, bySvc, generated);

  if (flags.dryRun) {
    process.stdout.write(md);
    return;
  }
  fs.writeFileSync(outPath, md);
  process.stdout.write(`wrote ${outPath} (${md.length} bytes, ${roster.length} rows)\n`);
}

try {
  main();
} catch (e) {
  process.stderr.write(`error: ${e.message}\n`);
  process.exit(1);
}