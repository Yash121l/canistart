#!/usr/bin/env node
import { GitHubError } from './github.js';
import { main } from './cli.js';

main(process.argv.slice(2), process.env)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const detail = error instanceof GitHubError ? error.message : (error as Error).message;
    process.stderr.write(`canistart: ${detail}\n`);
    process.exitCode = 3;
  });
