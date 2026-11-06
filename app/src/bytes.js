// Bytes for the index file: unsigned integers of variable length (seven bits
// per byte, lowest first, the high bit says that another byte follows) and a
// buffer that grows while it is written.
//
// The index is kept in Buffers and not in JavaScript objects. A Buffer lives
// outside the V8 heap: it is as large as its data, it does not count against
// the heap limit, and it has no upper bound like the 512 MiB of a string.

// Numbers up to Number.MAX_SAFE_INTEGER; bit operations alone would stop at
// 32 bits.
export class ByteWriter {
  constructor(capacity = 1 << 12) {
    this.buf = Buffer.allocUnsafe(capacity);
    this.length = 0;
  }

  ensure(extra) {
    const needed = this.length + extra;
    if (needed <= this.buf.length) return;
    const grown = Buffer.allocUnsafe(Math.max(needed, this.buf.length * 2));
    this.buf.copy(grown, 0, 0, this.length);
    this.buf = grown;
  }

  varint(n) {
    this.ensure(8);
    const { buf } = this;
    let at = this.length;
    while (n > 127) {
      buf[at++] = (n & 127) | 128;
      n = n > 0xffffffff ? Math.floor(n / 128) : n >>> 7;
    }
    buf[at++] = n;
    this.length = at;
  }

  bytes(source, start = 0, end = source.length) {
    this.ensure(end - start);
    source.copy(this.buf, this.length, start, end);
    this.length += end - start;
  }

  // What was written so far, as a view; valid until the next write.
  view() {
    return this.buf.subarray(0, this.length);
  }

  // What was written so far, as a Buffer of its own.
  take() {
    const out = Buffer.allocUnsafeSlow(this.length);
    this.buf.copy(out, 0, 0, this.length);
    this.length = 0;
    return out;
  }

  reset() {
    this.length = 0;
  }
}

export class ByteReader {
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  varint() {
    const { buf } = this;
    let byte = buf[this.pos++];
    if (byte < 128) return byte;
    let n = byte & 127;
    let factor = 128;
    do {
      byte = buf[this.pos++];
      n += (byte & 127) * factor;
      factor *= 128;
    } while (byte > 127);
    return n;
  }
}
