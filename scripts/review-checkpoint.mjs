import { freezeInputs, checkInputs } from '../lib/review-checkpoint.js';
const [command, workspace, checkpoint, ...extra] = process.argv.slice(2);
try {
  if (!['freeze','check'].includes(command) || !workspace || !checkpoint || extra.length) throw new Error('Usage: node scripts/review-checkpoint.mjs freeze|check <workspace> <checkpoint.json>');
  if (command === 'freeze') {
    const value = freezeInputs(workspace, checkpoint);
    console.log(JSON.stringify({ revision: value.revision, files: value.files.length, note: 'Independent review still required' }));
  } else {
    const value = checkInputs(workspace, checkpoint);
    console.log(JSON.stringify(value));
    if (!value.unchanged) process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 2; }
