// Fixed test process: input is JSON data, never executable instructions.
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 131072) throw new Error('Fixture input too large');
}
const { plan, delayMs } = JSON.parse(input);
await new Promise((resolve) => setTimeout(resolve, delayMs));
process.stdout.write(JSON.stringify(plan));
