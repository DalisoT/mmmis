#!/usr/bin/env node

import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = join(projectRoot, 'supabase', 'functions');
const projectRef = process.env.SUPABASE_PROJECT_REF ?? 'gkegnmshivmgqhenqkzr';

const standardFunctions = [
  'bootstrap-admin',
  'create-user',
  'chit-authorize',
  'password-reset',
  'admin-reset-password',
  'set-member-email',
  'bulk-seed-members',
  'expire-chit-authorizations',
  'push-dispatch',
];
const destructiveFunctions = ['admin-wipe-auth-users'];
const knownFunctions = [...standardFunctions, ...destructiveFunctions];

function fail(message) {
  console.error(`Function deployer: ${message}`);
  process.exit(1);
}

function deploy(name) {
  console.log(`\nDeploying ${name}...`);
  const result = spawnSync(
    'npx',
    ['--no-install', 'supabase', 'functions', 'deploy', name, '--project-ref', projectRef, '--no-verify-jwt'],
    {
      cwd: projectRoot,
      shell: process.platform === 'win32',
      stdio: 'inherit',
    },
  );

  if (result.error) fail(`could not start the project-local Supabase CLI: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(functionsDir)) fail('supabase/functions was not found');

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const includeDestructive = args.includes('--include-destructive');
const requested = args.filter((arg) => !arg.startsWith('--'));
const discovered = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(functionsDir, entry.name, 'index.ts')))
  .map((entry) => entry.name)
  .sort();

const unmanaged = discovered.filter((name) => !knownFunctions.includes(name));
if (unmanaged.length > 0) fail(`function manifest is missing: ${unmanaged.join(', ')}`);

let selected = requested.length > 0 ? requested : standardFunctions;
const unknown = selected.filter((name) => !knownFunctions.includes(name));
if (unknown.length > 0) fail(`unknown function(s): ${unknown.join(', ')}`);
if (selected.some((name) => destructiveFunctions.includes(name)) && !includeDestructive) {
  fail('admin-wipe-auth-users requires --include-destructive');
}
selected = [...new Set(selected)];

console.log(`Target project: ${projectRef}`);
console.log(`Functions selected (${selected.length}): ${selected.join(', ')}`);
console.log('Gateway JWT verification: disabled; each function performs application-level authorization.');

if (!execute) {
  console.log('\nPreflight only; nothing was deployed.');
  console.log('Deploy standard functions with: npm run fn:deploy -- --execute');
  console.log('Deploy one function with: npm run fn:deploy -- push-dispatch --execute');
  process.exit(0);
}

if (process.env.CONFIRM_SUPABASE_PROJECT_REF !== projectRef) {
  fail(`set CONFIRM_SUPABASE_PROJECT_REF=${projectRef} to confirm the deployment target`);
}

for (const name of selected) deploy(name);
console.log('\nFunction deployment completed. Verify required secrets and the push-dispatch database webhook.');
