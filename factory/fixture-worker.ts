// Fixed test process: input is JSON data, never executable instructions.
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  if (typeof chunk !== 'string') throw new Error('Fixture input must be UTF-8 text');
  input += chunk;
  if (Buffer.byteLength(input) > 131072) throw new Error('Fixture input too large');
}
const parsed: unknown = JSON.parse(input);
if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || typeof Reflect.get(parsed, 'delayMs') !== 'number') {
  throw new Error('Fixture input is invalid');
}
const plan = Reflect.get(parsed, 'plan');
const delayMs = Reflect.get(parsed, 'delayMs');
await new Promise((resolve) => setTimeout(resolve, delayMs));
process.stdout.write(JSON.stringify(plan));
