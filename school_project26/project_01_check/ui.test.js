'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'school_project_01_check.v0.7.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const tailwindCss = fs.readFileSync(path.join(root, 'tailwind.generated.css'), 'utf8');

assert.match(html, /<html lang="ko">/, 'document language is required');
assert.match(html, /<meta name="description"/, 'SEO description is required');
assert.match(html, /<meta name="viewport"/, 'responsive viewport is required');
assert.match(html, /class="skip-link" href="#primary-content"/, 'keyboard skip link is required');
assert.match(html, /role="tablist"/, 'semantic tab navigation is required');
assert.match(html, /aria-live="polite"/, 'async status announcements are required');
assert.match(styles, /:focus-visible/, 'visible keyboard focus is required');
assert.match(styles, /\.hidden \{ display: none !important; \}/, 'component styles must not override hidden state');
assert.match(styles, /\.app-shell \{ width: min\(100%, 1000px\);/, 'application shell must use the 1000px base width');
assert.match(html, /id="task-menu-button"[^>]+aria-expanded="false"[^>]+aria-controls="task-selector"/, 'task selector hamburger button is required');
assert.match(html, /id="task-selector" class="hidden task-menu-popover" role="menu"/, 'task selector must be a hidden popup menu');
assert.match(styles, /\.task-menu-popover \{[^}]*position: absolute;[^}]*flex-wrap: wrap;/, 'task popup must float and wrap overflowing items');
assert.match(styles, /\.task-selector-panel\.menu-open \{ z-index: 90; \}/, 'open task menu must appear above following cards');
assert.match(styles, /prefers-reduced-motion/, 'reduced-motion support is required');
assert.match(styles, /button \{ min-height: 44px;/, 'touch targets must meet the 44px guideline');
assert.doesNotMatch(styles, /min-height:\s*(?:3\d|4[0-3])px/, 'component styles must not reduce touch targets below 44px');
assert.ok(tailwindCss.length < 50000, 'compiled Tailwind CSS unexpectedly exceeds 50KB');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepStrictEqual(duplicateIds, [], `duplicate IDs: ${duplicateIds.join(', ')}`);

for (const inputId of ['login-password', 'add-sid', 'add-sname', 'add-topic', 'add-class-name']) {
  assert.match(html, new RegExp(`<label[^>]+for="${inputId}"`), `${inputId} needs an explicit label`);
}

for (const button of html.matchAll(/<button\b([^>]*)>/gi)) {
  assert.match(button[1], /\btype="button"/, `button is missing type="button": ${button[0].slice(0, 100)}`);
}

console.log('UI, SEO and accessibility regression tests passed.');
