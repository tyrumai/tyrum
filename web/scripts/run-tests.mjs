#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';

const rawArgs = process.argv.slice(2);
const forwardedArgs = rawArgs.filter((arg) => arg !== '--runInBand');
const sequenced = rawArgs.includes('--runInBand');

const hasSubcommand = forwardedArgs.length > 0 && !forwardedArgs[0].startsWith('-');

if (!hasSubcommand) {
  forwardedArgs.unshift('run');
}

if (sequenced) {
  if (!forwardedArgs.some((arg) => arg === '--maxWorkers' || arg.startsWith('--maxWorkers='))) {
    forwardedArgs.push('--maxWorkers', '1');
  }

  if (!forwardedArgs.some((arg) => arg === '--minWorkers' || arg.startsWith('--minWorkers='))) {
    forwardedArgs.push('--minWorkers', '1');
  }

  const hasFileParallelOverride = forwardedArgs.some((arg) =>
    arg === '--no-file-parallelism' || arg.startsWith('--fileParallelism')
  );

  if (!hasFileParallelOverride) {
    forwardedArgs.push('--no-file-parallelism');
  }
}

const require = createRequire(import.meta.url);
const vitestPackage = require.resolve('vitest/package.json');
const vitestBin = join(dirname(vitestPackage), 'vitest.mjs');

const child = spawn(process.execPath, [vitestBin, ...forwardedArgs], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
