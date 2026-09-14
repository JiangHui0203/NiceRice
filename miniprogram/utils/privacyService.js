const PRIVACY_SECRET_KEY = "life_helper_local_privacy_secret";
const PRIVACY_SETTINGS_KEY = "life_helper_privacy_settings";
const { getWx } = require("./wechatRuntime.js");

const DEFAULT_SETTINGS = {
  localOnly: true,
  encryptAttachments: true,
  cloudUploadEnabled: false,
};

function normalizeSettings(value = {}, fallback = DEFAULT_SETTINGS) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_SETTINGS;
  return {
    localOnly: typeof source.localOnly === "boolean" ? source.localOnly : base.localOnly === true,
    encryptAttachments: typeof source.encryptAttachments === "boolean"
      ? source.encryptAttachments
      : base.encryptAttachments !== false,
    cloudUploadEnabled: typeof source.cloudUploadEnabled === "boolean"
      ? source.cloudUploadEnabled
      : base.cloudUploadEnabled === true,
  };
}

function randomText() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function getSettings() {
  const api = getWx();
  if (!api) return Object.assign({}, DEFAULT_SETTINGS);
  try {
    return normalizeSettings(api.getStorageSync(PRIVACY_SETTINGS_KEY), DEFAULT_SETTINGS);
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

function saveSettings(settings = {}) {
  const api = getWx();
  if (!api || !settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  try {
    api.setStorageSync(PRIVACY_SETTINGS_KEY, normalizeSettings(settings, getSettings()));
    return true;
  } catch (e) {
    return false;
  }
}

function isLocalOnly() {
  const settings = getSettings();
  return settings.localOnly === true || !settings.cloudUploadEnabled;
}

function isCloudUploadAllowed() {
  const settings = getSettings();
  return settings.localOnly !== true && settings.cloudUploadEnabled === true;
}

function buildPrivacyBlockedError(message) {
  const error = new Error(message || "隐私模式下不会上传私人数据");
  error.code = "privacy_local_only";
  return error;
}

function getLocalSecret() {
  const api = getWx();
  if (!api) return "dev_local_secret";
  try {
    let secret = api.getStorageSync(PRIVACY_SECRET_KEY);
    if (!secret) {
      secret = randomText();
      api.setStorageSync(PRIVACY_SECRET_KEY, secret);
    }
    return secret;
  } catch (e) {
    // Never encrypt durable data with a process fallback. If the secret could
    // not be persisted, a later launch would generate another key and make the
    // encrypted record or attachment permanently unreadable.
    return "";
  }
}

function seedFromText(text) {
  let seed = 2166136261;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    seed ^= source.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function nextByte(state) {
  let value = state.value || 1;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.value = value >>> 0;
  return state.value & 255;
}

function toHexByte(value) {
  return value.toString(16).padStart(2, "0");
}

function forEachUtf8Byte(text, callback) {
  const source = String(text || "");
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
      callback(codePoint);
    } else if (codePoint <= 0x7ff) {
      callback(0xc0 | (codePoint >> 6));
      callback(0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      callback(0xe0 | (codePoint >> 12));
      callback(0x80 | ((codePoint >> 6) & 0x3f));
      callback(0x80 | (codePoint & 0x3f));
    } else {
      callback(0xf0 | (codePoint >> 18));
      callback(0x80 | ((codePoint >> 12) & 0x3f));
      callback(0x80 | ((codePoint >> 6) & 0x3f));
      callback(0x80 | (codePoint & 0x3f));
    }
  }
}

function bytesToText(bytes = []) {
  const parts = [];
  let chunk = "";
  const append = (text) => {
    chunk += text;
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
    } else if (first >= 0xc2 && first <= 0xdf
      && index + 1 < bytes.length && isContinuation(bytes[index + 1])) {
      const code = ((first & 0x1f) << 6) | (bytes[index + 1] & 0x3f);
      append(String.fromCharCode(code));
      index += 1;
    } else if (first >= 0xe0 && first <= 0xef
      && index + 2 < bytes.length
      && isContinuation(bytes[index + 1]) && isContinuation(bytes[index + 2])) {
      const code = ((first & 0x0f) << 12) | ((bytes[index + 1] & 0x3f) << 6) | (bytes[index + 2] & 0x3f);
      if (code < 0x800 || (code >= 0xd800 && code <= 0xdfff)) return "";
      append(String.fromCharCode(code));
      index += 2;
    } else if (first >= 0xf0 && first <= 0xf4
      && index + 3 < bytes.length
      && isContinuation(bytes[index + 1]) && isContinuation(bytes[index + 2])
      && isContinuation(bytes[index + 3])) {
      const codePoint = ((first & 0x07) << 18) | ((bytes[index + 1] & 0x3f) << 12) | ((bytes[index + 2] & 0x3f) << 6) | (bytes[index + 3] & 0x3f);
      if (codePoint < 0x10000 || codePoint > 0x10ffff) return "";
      const adjusted = codePoint - 0x10000;
      append(String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff)));
      index += 3;
    } else {
      return "";
    }
  }
  if (chunk) parts.push(chunk);
  return parts.join("");
}

function encryptText(plainText, purpose = "local") {
  const nonce = randomText();
  const secret = getLocalSecret();
  if (!secret) throw new Error("本地加密密钥保存失败");
  const state = {
    value: seedFromText(`${secret}|${purpose}|${nonce}`),
  };
  const cipherParts = [];
  let cipherChunk = "";
  forEachUtf8Byte(plainText, (byte) => {
    cipherChunk += toHexByte(byte ^ nextByte(state));
    if (cipherChunk.length >= 16384) {
      cipherParts.push(cipherChunk);
      cipherChunk = "";
    }
  });
  if (cipherChunk) cipherParts.push(cipherChunk);
  return {
    algorithm: "lh-local-stream-v1",
    nonce,
    cipher: cipherParts.join(""),
  };
}

function decryptText(payload = {}, purpose = "local") {
  if (!payload || !payload.cipher || !payload.nonce
    || (payload.algorithm && payload.algorithm !== "lh-local-stream-v1")) return "";
  const secret = getLocalSecret();
  if (!secret) return "";
  const state = {
    value: seedFromText(`${secret}|${purpose}|${payload.nonce}`),
  };
  const cipher = String(payload.cipher || "");
  if (cipher.length % 2 !== 0) return "";
  const byteLength = Math.floor(cipher.length / 2);
  const bytes = new Uint8Array(byteLength);
  const hexNibble = (code) => {
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 70) return code - 55;
    if (code >= 97 && code <= 102) return code - 87;
    return -1;
  };
  for (let index = 0; index + 1 < cipher.length; index += 2) {
    const high = hexNibble(cipher.charCodeAt(index));
    const low = hexNibble(cipher.charCodeAt(index + 1));
    if (high < 0 || low < 0) return "";
    bytes[index / 2] = ((high << 4) | low) ^ nextByte(state);
  }
  return bytesToText(bytes);
}

function createEncryptionNonce() {
  return randomText();
}

function transformBinaryInPlace(buffer, purpose, nonce, byteOffset = 0, byteLength) {
  if (!nonce) return false;
  const isArrayBuffer = buffer instanceof ArrayBuffer;
  const isView = !isArrayBuffer
    && typeof ArrayBuffer.isView === "function"
    && ArrayBuffer.isView(buffer)
    && buffer.buffer instanceof ArrayBuffer;
  if (!isArrayBuffer && !isView) return false;
  const backingBuffer = isArrayBuffer ? buffer : buffer.buffer;
  const baseOffset = isArrayBuffer ? 0 : buffer.byteOffset;
  const availableLength = buffer.byteLength;
  const offset = Number(byteOffset);
  const length = byteLength === undefined ? availableLength - offset : Number(byteLength);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < 0 || length < 0 || offset > availableLength || length > availableLength - offset) return false;
  const secret = getLocalSecret();
  if (!secret) return false;
  const state = { value: seedFromText(`${secret}|${purpose}|${nonce}`) };
  const bytes = new Uint8Array(backingBuffer, baseOffset + offset, length);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] ^= nextByte(state);
  }
  return true;
}

function isEncryptedRecord(value) {
  return Boolean(value && value.__encrypted && value.payload);
}

const nodeMemoryStore = Object.create(null);
const memoryCache = Object.create(null);

function cloneStoredValue(value) {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

function clearMemoryCache(key) {
  if (key) {
    delete memoryCache[key];
  } else {
    Object.keys(memoryCache).forEach((k) => delete memoryCache[k]);
  }
}

function readLocalData(key, fallback) {
  if (memoryCache[key] !== undefined) {
    return cloneStoredValue(memoryCache[key]);
  }
  const api = getWx();
  if (!api) {
    return nodeMemoryStore[key] !== undefined
      ? cloneStoredValue(nodeMemoryStore[key])
      : cloneStoredValue(fallback);
  }
  try {
    const stored = api.getStorageSync(key);
    if (stored === undefined || stored === null || stored === "") return cloneStoredValue(fallback);
    let result = stored;
    if (isEncryptedRecord(stored)) {
      const text = decryptText(stored.payload, key);
      // Decryption can fail transiently when the platform storage API is
      // unavailable. Returning the fallback is safe, but caching it would
      // hide recoverable durable data for the rest of the process.
      if (!text) return cloneStoredValue(fallback);
      result = JSON.parse(text);
    }
    memoryCache[key] = cloneStoredValue(result);
    return cloneStoredValue(result);
  } catch (e) {
    return fallback;
  }
}

function writeLocalData(key, value) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return false;
    const api = getWx();
    if (!api) {
      const storedValue = JSON.parse(serialized);
      nodeMemoryStore[key] = storedValue;
      memoryCache[key] = cloneStoredValue(storedValue);
      return true;
    }
    api.setStorageSync(key, {
      __encrypted: true,
      version: 1,
      payload: encryptText(serialized, key),
    });
    // The cache represents the last durable value. Updating it only after the
    // synchronous storage call succeeds avoids ghost state after quota errors.
    memoryCache[key] = JSON.parse(serialized);
    return true;
  } catch (e) {
    return false;
  }
}

function removeLocalData(key) {
  const normalizedKey = typeof key === "string" ? key.trim() : "";
  if (!normalizedKey) return false;
  try {
    const api = getWx();
    if (!api) {
      delete nodeMemoryStore[normalizedKey];
      delete memoryCache[normalizedKey];
      return true;
    }
    if (typeof api.removeStorageSync !== "function") return false;
    api.removeStorageSync(normalizedKey);
    // Keep the in-process view aligned only after the durable removal succeeds.
    delete memoryCache[normalizedKey];
    return true;
  } catch (error) {
    return false;
  }
}

function getStorageDiagnostics() {
  const api = getWx();
  let itemCount = 0;
  let estimatedKb = 0;
  if (api && typeof api.getStorageInfoSync === "function") {
    try {
      const info = api.getStorageInfoSync();
      itemCount = (info.keys || []).length;
      estimatedKb = info.currentSize || 0;
    } catch (e) {
      itemCount = 0;
      estimatedKb = 0;
    }
  } else {
    itemCount = Object.keys(nodeMemoryStore).length;
    estimatedKb = 0;
  }
  return { itemCount, estimatedKb };
}

module.exports = {
  DEFAULT_SETTINGS,
  buildPrivacyBlockedError,
  createEncryptionNonce,
  decryptText,
  encryptText,
  getLocalSecret,
  getSettings,
  isEncryptedRecord,
  isLocalOnly,
  isCloudUploadAllowed,
  normalizeSettings,
  readLocalData,
  removeLocalData,
  saveSettings,
  transformBinaryInPlace,
  writeLocalData,
  clearMemoryCache,
  getStorageDiagnostics,
};
