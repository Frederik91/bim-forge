import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const sourceRoots = ['benchmarks', 'demo', 'factory', 'scripts', 'src'];
const javascriptExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const suppressionPattern = new RegExp(`${'@'}${'ts'}-(?:ignore|expect-error|nocheck)|${'eslint'}-${'disable'}`);
const forbiddenTypePattern = new RegExp(`\\b${'any'}\\b`, 'g');

type ScanState = 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment';

function maskNonCode(text: string): string {
  let state: ScanState = 'code';
  let escaped = false;
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (state === 'code') {
      if (char === '/' && next === '/') { state = 'line-comment'; output += '  '; index += 1; continue; }
      if (char === '/' && next === '*') { state = 'block-comment'; output += '  '; index += 1; continue; }
      if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
      else if (char === '`') state = 'template';
      output += state === 'code' ? char : ' ';
      continue;
    }
    if (state === 'line-comment') {
      if (char === '\n') { state = 'code'; output += '\n'; } else output += ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') { state = 'code'; output += '  '; index += 1; }
      else output += char === '\n' ? '\n' : ' ';
      continue;
    }
    output += char === '\n' ? '\n' : ' ';
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if ((state === 'single' && char === "'") || (state === 'double' && char === '"')
        || (state === 'template' && char === '`')) state = 'code';
  }
  return output;
}

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
  });
}

function relative(filename: string): string {
  return path.relative(process.cwd(), filename).replaceAll('\\', '/');
}

const files = sourceRoots.flatMap((root) => walk(path.join(process.cwd(), root)));
const violations: string[] = [];

for (const filename of files) {
  const extension = path.extname(filename).toLowerCase();
  if (javascriptExtensions.has(extension)) {
    violations.push(`${relative(filename)}: JavaScript source is forbidden; use TypeScript`);
    continue;
  }
  if (extension !== '.ts' && extension !== '.tsx') continue;
  const text = fs.readFileSync(filename, 'utf8');
  if (suppressionPattern.test(text)) {
    violations.push(`${relative(filename)}: TypeScript and lint suppression directives are forbidden`);
  }
  const code = maskNonCode(text);
  for (const match of code.matchAll(forbiddenTypePattern)) {
    const line = code.slice(0, match.index).split(/\r?\n/).length;
    violations.push(`${relative(filename)}:${line}: explicit any is forbidden; validate unknown input instead`);
  }
}

if (violations.length > 0) throw new Error(`Strict TypeScript validation failed:\n${violations.join('\n')}`);
console.log(`Strict TypeScript valid. ${files.filter((file) => /\.tsx?$/.test(file)).length} source file(s) checked.`);
