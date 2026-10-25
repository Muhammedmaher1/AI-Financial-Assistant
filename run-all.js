// Runs every *.test.js in this folder. No dependencies: `node tests/run-all.js` (Node 18+).
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
let failed = 0;
for (const f of fs.readdirSync(__dirname).filter(x => x.endsWith('.test.js')).sort()) {
  let out = '';
  try { out = execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const line = (out.match(/\d+\/\d+ passed[^\n]*/g) || ['no result']).pop();
  const fails = (out.match(/^FAIL .*/gm) || []);
  if (fails.length || line === 'no result') failed++;
  console.log(f.padEnd(20), line); fails.forEach(x => console.log('   ' + x));
}
process.exit(failed ? 1 : 0);
