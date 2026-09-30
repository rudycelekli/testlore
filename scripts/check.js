import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.[cm]?js$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
check('src');
check('scripts');
console.log('Source and script syntax checks passed.');
