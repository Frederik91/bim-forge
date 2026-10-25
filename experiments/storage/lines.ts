import { StringDecoder } from 'node:string_decoder';

// Pull chunks only when the consumer asks for the next row; no event-line queue accumulates during database writes.
export async function* boundedLines(input: AsyncIterable<unknown>): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8');
  const maximum = 4 * 1024 * 1024;
  let tail = '';
  for await (const chunk of input) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Expected UTF-8 byte stream');
    const text = tail + decoder.write(chunk);
    let start = 0;
    let end = text.indexOf('\n', start);
    while (end !== -1) {
      const line = text.slice(start, end);
      if (Buffer.byteLength(line) > maximum) throw new Error('Source row exceeds 4 MiB admission bound');
      yield line.endsWith('\r') ? line.slice(0, -1) : line;
      start = end + 1; end = text.indexOf('\n', start);
    }
    tail = text.slice(start);
    if (Buffer.byteLength(tail) > maximum) throw new Error('Unterminated source row exceeds 4 MiB bound');
  }
  tail += decoder.end();
  if (tail.length > 0) yield tail;
}
