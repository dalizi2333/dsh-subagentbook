import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freezeInputs, checkInputs } from '../lib/review-checkpoint.js';

test('final changes invalidate independent review inputs; ignored evidence does not', () => {
 const dir=mkdtempSync(join(tmpdir(),'sb-review-')), root=join(dir,'repo'), receipt=join(dir,'review.json');
 mkdirSync(root); const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
 try {
  git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  writeFileSync(join(root,'.gitignore'),'evidence/\n');writeFileSync(join(root,'source.txt'),'before');git('add','.');git('commit','-m','input');
  writeFileSync(join(root,'untracked.txt'),'included');freezeInputs(root,receipt);
  assert.equal(checkInputs(root,receipt).unchanged,true);
  const cli=fileURLToPath(new URL('../scripts/review-checkpoint.mjs',import.meta.url));
  assert.equal(JSON.parse(execFileSync(process.execPath,[cli,'check',root,receipt],{encoding:'utf8'})).unchanged,true);
  mkdirSync(join(root,'evidence'));writeFileSync(join(root,'evidence','report.md'),'independent report');assert.equal(checkInputs(root,receipt).unchanged,true);
  writeFileSync(join(root,'source.txt'),'final fix');assert.equal(checkInputs(root,receipt).unchanged,false);
  assert.throws(()=>execFileSync(process.execPath,[cli,'check',root,receipt],{stdio:'pipe'}),error=>error.status===1);
  writeFileSync(join(root,'source.txt'),'before');assert.equal(checkInputs(root,receipt).unchanged,true);
  rmSync(join(root,'untracked.txt'));assert.equal(checkInputs(root,receipt).unchanged,false);writeFileSync(join(root,'untracked.txt'),'included');
  chmodSync(join(root,'source.txt'),0o755);assert.equal(checkInputs(root,receipt).unchanged,false);chmodSync(join(root,'source.txt'),0o644);
  git('commit','--allow-empty','-m','new revision');assert.equal(checkInputs(root,receipt).unchanged,false);
  assert.throws(()=>freezeInputs(root,receipt),/EEXIST/);
  assert.throws(()=>freezeInputs(root,join(root,'self.json')),/ignored evidence/);
  freezeInputs(root,join(root,'evidence','review.json'));
  symlinkSync(join(root,'source.txt'),join(root,'alias'));assert.throws(()=>freezeInputs(root,join(dir,'link.json')),/Unsupported input/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
