import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('admin console keeps an enforced idle-lock control in the UI code',async()=>{
  const source=await fs.readFile(new URL('./app.js',import.meta.url),'utf8');
  assert.match(source,/SESSION_IDLE_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
  assert.match(source,/idleTimer/);
  assert.match(source,/Date\.now\(\)-lastActivity>SESSION_IDLE_MS\)logout\(\)/);
  assert.match(source,/clearInterval\(idleTimer\);idleTimer=null/);
  assert.match(source,/invoke\?\.\('clear_token'\)/);
  assert.match(source,/pointerdown','keydown','mousemove','touchstart/);
});
