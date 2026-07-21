'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const gs = fs.readFileSync(path.join(root, 'code.gs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'school_project_01_check.v0.7.html'), 'utf8');

// Syntax regression checks for Apps Script-compatible JavaScript and inline scripts.
assert.doesNotThrow(() => new Function(gs), 'code.gs contains invalid JavaScript');
const scriptPattern = /<script(?:[^>]*)>([\s\S]*?)<\/script>/gi;
for (const match of html.matchAll(scriptPattern)) {
  if (match[1].trim()) assert.doesNotThrow(() => new Function(match[1]), 'HTML contains invalid inline JavaScript');
}

// Security and state-management invariants.
assert.match(html, /let pendingUpdates = new Map\(\)/);
assert.doesNotMatch(html, /onclick=[^>]*\$\{/i, 'untrusted values must not be embedded in inline handlers');
assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i, 'runtime CDN scripts are not allowed');
assert.doesNotMatch(html, /tailwindcss-3\.4\.17\.js/, 'Tailwind browser runtime must not be loaded');
assert.match(html, /tailwind\.generated\.css/, 'compiled Tailwind stylesheet is required');
assert.doesNotMatch(html, /@import\s+url\(["']?https?:\/\//i, 'runtime external CSS imports are not allowed');
assert.match(gs, /const rowByStudentId = new Map\(\)/);
assert.match(gs, /getRangeList\(ranges\)\.setValue\(status\)/);
assert.match(gs, /if \(action === 'get_data'\)[\s\S]*return getDataResponse/);
assert.ok(gs.indexOf("if (action === 'get_data')") < gs.indexOf('const lock = LockService.getScriptLock();'), 'normal reads must occur before the write lock');

const expectedHashes = new Map([
  ['html-to-image-1.11.11.min.js', '8A724976A1594D38BEDD545FFB8140CCB2ECD99DEB76377719A9E6CDEEC3AC1E'],
  ['xlsx-0.18.5.full.min.js', 'C9506197CAF809A075B6DEE1DA0D36FB19DA7158FFE8A88E7B0C96C5D8623C99']
]);
for (const [fileName, expectedHash] of expectedHashes) {
  const bytes = fs.readFileSync(path.join(root, 'vendor', fileName));
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  assert.strictEqual(actualHash, expectedHash, `${fileName} checksum mismatch`);
}

console.log('Security regression tests passed.');
