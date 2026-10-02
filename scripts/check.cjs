'use strict';
const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
for (const dir of ['api', 'lib', 'scripts', 'tests', 'public']) {
  for (const name of readdirSync(dir).filter(n => /\.(c?js)$/.test(n))) {
    const r = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }
}
