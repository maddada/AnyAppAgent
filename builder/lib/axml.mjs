// Sets android:versionCode in a compiled (binary) AndroidManifest.xml, in place. The value is a
// 4-byte integer inside the <manifest> element's attribute, so the file keeps its size and nothing
// else moves. Used by the fast lane's bundle swap (lib/fastlane.mjs): a new APK from the last one,
// with a new JavaScript bundle and a higher version code, without Gradle.
//
// Binary XML layout (frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h):
//   ResChunk_header { u16 type, u16 headerSize, u32 size }
//   RES_XML_TYPE 0x0003 > RES_STRING_POOL_TYPE 0x0001, RES_XML_RESOURCE_MAP_TYPE 0x0180, nodes
//   RES_XML_START_ELEMENT_TYPE 0x0102: header(8) lineNumber(4) comment(4), then ResXMLTree_attrExt
//     { ns u32, name u32, attributeStart u16, attributeSize u16, attributeCount u16, id, class, style }
//   ResXMLTree_attribute { ns u32, name u32, rawValue u32, Res_value { u16 size, u8 0, u8 dataType, u32 data } }

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const ATTR_VERSION_CODE = 0x0101021b;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;

function readPoolString(buf, poolStart, index) {
  const stringCount = buf.readUInt32LE(poolStart + 8);
  if (index >= stringCount) return null;
  const flags = buf.readUInt32LE(poolStart + 16);
  const stringsStart = poolStart + buf.readUInt32LE(poolStart + 20);
  const headerSize = buf.readUInt16LE(poolStart + 2);
  let p = stringsStart + buf.readUInt32LE(poolStart + headerSize + index * 4);
  if (flags & 0x100) {
    // UTF-8: char length (1 or 2 bytes), byte length (1 or 2 bytes), bytes
    p += buf[p] & 0x80 ? 2 : 1;
    let len = buf[p];
    if (len & 0x80) {
      len = ((len & 0x7f) << 8) | buf[p + 1];
      p += 2;
    } else p += 1;
    return buf.subarray(p, p + len).toString('utf8');
  }
  let len = buf.readUInt16LE(p);
  p += 2;
  if (len & 0x8000) {
    len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p);
    p += 2;
  }
  return buf.subarray(p, p + len * 2).toString('utf16le');
}

/** Returns { offset, value } of the versionCode data word, or throws. */
function findVersionCode(buf) {
  if (buf.readUInt16LE(0) !== RES_XML_TYPE) throw new Error('not a binary XML file');
  let p = buf.readUInt16LE(2);
  let pool = -1;
  let resMap = [];
  while (p < buf.length) {
    const type = buf.readUInt16LE(p);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8) throw new Error('bad chunk');
    if (type === RES_STRING_POOL_TYPE) pool = p;
    else if (type === RES_XML_RESOURCE_MAP_TYPE) {
      const hs = buf.readUInt16LE(p + 2);
      resMap = [];
      for (let q = p + hs; q < p + size; q += 4) resMap.push(buf.readUInt32LE(q));
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      const ext = p + buf.readUInt16LE(p + 2);
      const elementName = readPoolString(buf, pool, buf.readUInt32LE(ext + 4));
      if (elementName !== 'manifest') throw new Error(`the first element is <${elementName}>, not <manifest>`);
      const attrStart = buf.readUInt16LE(ext + 8);
      const attrSize = buf.readUInt16LE(ext + 10);
      const attrCount = buf.readUInt16LE(ext + 12);
      for (let i = 0; i < attrCount; i++) {
        const a = ext + attrStart + i * attrSize;
        const nameIndex = buf.readUInt32LE(a + 4);
        const isVersionCode = resMap[nameIndex] === ATTR_VERSION_CODE || (resMap.length <= nameIndex && readPoolString(buf, pool, nameIndex) === 'versionCode');
        if (!isVersionCode) continue;
        const dataType = buf[a + 15];
        if (dataType !== TYPE_INT_DEC && dataType !== TYPE_INT_HEX) throw new Error(`versionCode has value type ${dataType}, not an integer`);
        return { offset: a + 16, value: buf.readUInt32LE(a + 16), rawValue: buf.readInt32LE(a + 8), rawOffset: a + 8 };
      }
      throw new Error('<manifest> has no versionCode');
    }
    p += size;
  }
  throw new Error('no <manifest> element');
}

export function readVersionCode(manifest) {
  return findVersionCode(manifest).value;
}

/** A copy of the binary manifest with versionCode = `code`. */
export function setVersionCode(manifest, code) {
  const out = Buffer.from(manifest);
  const at = findVersionCode(out);
  out.writeUInt32LE(code >>> 0, at.offset);
  // A raw string value, if the compiler kept one (it normally does not: -1), must not disagree.
  if (at.rawValue !== -1) out.writeInt32LE(-1, at.rawOffset);
  return out;
}
