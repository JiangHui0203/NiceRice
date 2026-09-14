const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function textToUtf8Bytes(text) {
  const source = String(text || "");
  let byteLength = 0;
  for (let index = 0; index < source.length; index += 1) {
    let codePoint = source.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < source.length) {
      const next = source.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    byteLength += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (let index = 0; index < source.length; index += 1) {
    let codePoint = source.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < source.length) {
      const next = source.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (codePoint <= 0x7f) {
      bytes[offset++] = codePoint;
    } else if (codePoint <= 0x7ff) {
      bytes[offset++] = 0xc0 | (codePoint >> 6);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    } else if (codePoint <= 0xffff) {
      bytes[offset++] = 0xe0 | (codePoint >> 12);
      bytes[offset++] = 0x80 | ((codePoint >> 6) & 0x3f);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    } else {
      bytes[offset++] = 0xf0 | (codePoint >> 18);
      bytes[offset++] = 0x80 | ((codePoint >> 12) & 0x3f);
      bytes[offset++] = 0x80 | ((codePoint >> 6) & 0x3f);
      bytes[offset++] = 0x80 | (codePoint & 0x3f);
    }
  }
  return bytes;
}

function utf8BytesToText(bytes = []) {
  const parts = [];
  let chunk = "";
  const append = (value) => {
    chunk += value;
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = "";
    }
  };
  const isContinuation = (value) => Number.isInteger(value) && (value & 0xc0) === 0x80;
  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index];
    if (first < 0x80) {
      append(String.fromCharCode(first));
    } else if ((first & 0xe0) === 0xc0 && index + 1 < bytes.length
      && isContinuation(bytes[index + 1])) {
      append(String.fromCharCode(((first & 0x1f) << 6) | (bytes[index + 1] & 0x3f)));
      index += 1;
    } else if ((first & 0xf0) === 0xe0 && index + 2 < bytes.length
      && isContinuation(bytes[index + 1]) && isContinuation(bytes[index + 2])) {
      append(String.fromCharCode(
        ((first & 0x0f) << 12)
        | ((bytes[index + 1] & 0x3f) << 6)
        | (bytes[index + 2] & 0x3f),
      ));
      index += 2;
    } else if ((first & 0xf8) === 0xf0 && index + 3 < bytes.length
      && isContinuation(bytes[index + 1]) && isContinuation(bytes[index + 2])
      && isContinuation(bytes[index + 3])) {
      const codePoint = ((first & 0x07) << 18)
        | ((bytes[index + 1] & 0x3f) << 12)
        | ((bytes[index + 2] & 0x3f) << 6)
        | (bytes[index + 3] & 0x3f);
      if (codePoint < 0x10000 || codePoint > 0x10ffff) {
        throw new Error("Base64 内容不是有效的 UTF-8 文本");
      }
      const adjusted = codePoint - 0x10000;
      append(String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff)));
      index += 3;
    } else {
      throw new Error("Base64 内容不是有效的 UTF-8 文本");
    }
  }
  if (chunk) parts.push(chunk);
  return parts.join("");
}

function encodeBase64(text) {
  const bytes = textToUtf8Bytes(text);
  const parts = [];
  let chunk = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : null;
    const third = index + 2 < bytes.length ? bytes[index + 2] : null;
    chunk += BASE64_CHARS[first >> 2];
    chunk += BASE64_CHARS[((first & 0x03) << 4) | (second === null ? 0 : second >> 4)];
    chunk += second === null ? "=" : BASE64_CHARS[((second & 0x0f) << 2) | (third === null ? 0 : third >> 6)];
    chunk += third === null ? "=" : BASE64_CHARS[third & 0x3f];
    if (chunk.length >= 16384) {
      parts.push(chunk);
      chunk = "";
    }
  }
  if (chunk) parts.push(chunk);
  return parts.join("");
}

function encodeBase64Url(text) {
  return encodeBase64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64(text) {
  const source = String(text || "").trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  if (!source) return "";
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(source) || source.length % 4 === 1) {
    throw new Error("Base64 格式不正确");
  }
  const unpadded = source.replace(/=+$/g, "");
  const bytes = new Uint8Array(Math.floor((unpadded.length * 6) / 8));
  let offset = 0;
  for (let index = 0; index < unpadded.length; index += 4) {
    const first = BASE64_CHARS.indexOf(unpadded[index]);
    const second = BASE64_CHARS.indexOf(unpadded[index + 1]);
    const third = index + 2 < unpadded.length ? BASE64_CHARS.indexOf(unpadded[index + 2]) : -1;
    const fourth = index + 3 < unpadded.length ? BASE64_CHARS.indexOf(unpadded[index + 3]) : -1;
    if (first < 0 || second < 0) throw new Error("Base64 格式不正确");
    bytes[offset++] = (first << 2) | (second >> 4);
    if (third >= 0) bytes[offset++] = ((second & 0x0f) << 4) | (third >> 2);
    if (fourth >= 0) bytes[offset++] = ((third & 0x03) << 6) | fourth;
  }
  return utf8BytesToText(offset === bytes.length ? bytes : bytes.subarray(0, offset));
}

module.exports = {
  decodeBase64,
  encodeBase64,
  encodeBase64Url,
};
