// Minimal GGUF metadata reader - parses the KV header without loading weights.
// Used to detect vision models (need an mmproj) and mmproj projector files.

const fs = require('fs');

const GGUF_MAGIC = 0x46554747; // "GGUF" little-endian

const METADATA_TYPES = {
  0: 'u8', 1: 'i8', 2: 'u16', 3: 'i16', 4: 'u32', 5: 'i32',
  6: 'f32', 7: 'bool', 8: 'string', 9: 'array',
  10: 'u64', 11: 'i64', 12: 'f64'
};

class Reader {
  constructor(buf) { this.buf = buf; this.off = 0; }
  u32() { const v = this.buf.readUInt32LE(this.off); this.off += 4; return v; }
  u64() { const v = this.buf.readBigUInt64LE(this.off); this.off += 8; return v; }
  i64() { const v = this.buf.readBigInt64LE(this.off); this.off += 8; return v; }
  f64() { const v = this.buf.readDoubleLE(this.off); this.off += 8; return v; }
  f32() { const v = this.buf.readFloatLE(this.off); this.off += 4; return v; }
  u8() { const v = this.buf.readUInt8(this.off); this.off += 1; return v; }
  str() {
    const len = this.u64();
    const v = this.buf.toString('utf8', this.off, this.off + Number(len));
    this.off += Number(len);
    return v;
  }
}

function readValue(r, type) {
  switch (type) {
    case 'u8': return r.u8();
    case 'i8': return r.buf.readInt8(r.off++);
    case 'u16': { const v = r.buf.readUInt16LE(r.off); r.off += 2; return v; }
    case 'i16': { const v = r.buf.readInt16LE(r.off); r.off += 2; return v; }
    case 'u32': return r.u32();
    case 'i32': { const v = r.buf.readInt32LE(r.off); r.off += 4; return v; }
    case 'f32': return r.f32();
    case 'bool': return r.u8() === 1;
    case 'string': return r.str();
    case 'u64': case 'i64': return Number(r.u64());
    case 'f64': return r.f64();
    case 'array': {
      const etype = METADATA_TYPES[r.u32()];
      const count = Number(r.u64());
      const out = [];
      for (let i = 0; i < count && r.off < r.buf.length; i++) out.push(readValue(r, etype));
      return out;
    }
    default: throw new Error('unknown metadata type ' + type);
  }
}

// Parse header + metadata of a GGUF file.
function inspectGguf(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    const buf = head.subarray(0, n);
    const r = new Reader(buf);
    if (r.u32() !== GGUF_MAGIC) return { valid: false, error: 'Not a GGUF file (bad magic). The file may be corrupted or a different format.' };
    const version = r.u32();
    const tensorCount = Number(r.u64());
    const kvCount = Number(r.u64());
    const meta = {};
    for (let i = 0; i < kvCount && r.off < buf.length - 8; i++) {
      const key = r.str();
      const t = METADATA_TYPES[r.u32()];
      if (!t) break;
      try { meta[key] = readValue(r, t); } catch (e) { break; }
    }
    const arch = String(meta['general.architecture'] || '');
    const name = String(meta['general.name'] || '');
    const sizeLabel = meta['general.size_label'] ? String(meta['general.size_label']) : '';
    const hasVision = meta['clip.has_vision'] === true || meta['clip.has_text_encoder'] === true;
    const isProjector = arch === 'clip' || meta['clip.has_vision'] === true;
    const fsize = fs.statSync(filePath).size;
    return {
      valid: true,
      version, arch, name, sizeLabel,
      tensorCount, fsize,
      hasVision, isProjector,
      isMmproj: isProjector && fsize < 4e9 && (arch === 'clip' || String(filePath).toLowerCase().includes('mmproj')),
      metadata: meta
    };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { inspectGguf };
