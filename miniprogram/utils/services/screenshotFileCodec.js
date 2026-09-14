const privacyService = require("../privacyService.js");
const { getWx } = require("../wechatRuntime.js");
const {
  MAX_SCREENSHOT_BYTES,
  MAX_ENCRYPTED_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_PIXELS,
  MAX_SCREENSHOTS,
  MAX_STORED_COUPON_RECORDS,
  MAX_PERSIST_CONCURRENCY,
  PREVIEW_TTL_MS,
  ORPHAN_ATTACHMENT_GRACE_MS,
  BINARY_SCREENSHOT_MAGIC,
  previewCleanupTimers,
  previewPathCache,
  previewResolutionPromises,
  previewOwnerPaths,
  createScreenshotId,
  getFs,
  getUserDataPath,
} = require("./screenshotContext.js");

function readFileArrayBuffer(filePath) {
  return new Promise((resolve, reject) => {
    const fs = getFs();
    if (!fs) {
      reject(new Error("当前环境不支持本地文件读取"));
      return;
    }
    fs.readFile({
      filePath,
      success(res) {
        const data = res && res.data;
        if (data instanceof ArrayBuffer) {
          resolve(data);
          return;
        }
        if (data && typeof ArrayBuffer.isView === "function" && ArrayBuffer.isView(data)
          && data.buffer instanceof ArrayBuffer) {
          const start = data.byteOffset;
          const end = start + data.byteLength;
          resolve(start === 0 && end === data.buffer.byteLength
            ? data.buffer
            : data.buffer.slice(start, end));
          return;
        }
        reject(new Error("本地图片二进制数据无效"));
      },
      fail: reject,
    });
  });
}

function readFileUtf8(filePath) {
  return new Promise((resolve, reject) => {
    const fs = getFs();
    if (!fs) {
      reject(new Error("当前环境不支持本地文件读取"));
      return;
    }
    fs.readFile({
      filePath,
      encoding: "utf8",
      success(res) {
        resolve(res.data || "");
      },
      fail: reject,
    });
  });
}

function writeFile(filePath, data, encoding = "utf8") {
  return new Promise((resolve, reject) => {
    const fs = getFs();
    if (!fs) {
      reject(new Error("当前环境不支持本地文件写入"));
      return;
    }
    const options = {
      filePath,
      data,
      success() {
        resolve(filePath);
      },
      fail: reject,
    };
    if (encoding) options.encoding = encoding;
    fs.writeFile(options);
  });
}

function packEncryptedScreenshotBuffer(sourceBuffer) {
  if (!(sourceBuffer instanceof ArrayBuffer)) throw new Error("图片二进制数据无效");
  const nonce = privacyService.createEncryptionNonce();
  if (!nonce || nonce.length > 255 || /[^\x20-\x7e]/.test(nonce)) {
    throw new Error("图片加密随机数生成失败");
  }
  const headerLength = BINARY_SCREENSHOT_MAGIC.length + 1 + nonce.length;
  const packed = new Uint8Array(headerLength + sourceBuffer.byteLength);
  for (let index = 0; index < BINARY_SCREENSHOT_MAGIC.length; index += 1) {
    packed[index] = BINARY_SCREENSHOT_MAGIC.charCodeAt(index);
  }
  packed[BINARY_SCREENSHOT_MAGIC.length] = nonce.length;
  for (let index = 0; index < nonce.length; index += 1) {
    packed[BINARY_SCREENSHOT_MAGIC.length + 1 + index] = nonce.charCodeAt(index);
  }
  packed.set(new Uint8Array(sourceBuffer), headerLength);
  if (!privacyService.transformBinaryInPlace(
    packed.buffer,
    "coupon_screenshot",
    nonce,
    headerLength,
    sourceBuffer.byteLength,
  )) {
    throw new Error("本地图片加密失败");
  }
  return packed.buffer;
}

function hasBinaryScreenshotMagic(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < BINARY_SCREENSHOT_MAGIC.length) return false;
  const bytes = new Uint8Array(buffer, 0, BINARY_SCREENSHOT_MAGIC.length);
  for (let index = 0; index < BINARY_SCREENSHOT_MAGIC.length; index += 1) {
    if (bytes[index] !== BINARY_SCREENSHOT_MAGIC.charCodeAt(index)) return false;
  }
  return true;
}

function unpackEncryptedScreenshotBuffer(packedBuffer) {
  if (!(packedBuffer instanceof ArrayBuffer)) throw new Error("加密图片数据无效");
  const packed = new Uint8Array(packedBuffer);
  const minimumLength = BINARY_SCREENSHOT_MAGIC.length + 2;
  if (packed.length < minimumLength) throw new Error("加密图片内容不完整");
  if (!hasBinaryScreenshotMagic(packedBuffer)) throw new Error("加密图片格式不受支持");
  const nonceLength = packed[BINARY_SCREENSHOT_MAGIC.length];
  const payloadOffset = BINARY_SCREENSHOT_MAGIC.length + 1 + nonceLength;
  if (!nonceLength || payloadOffset >= packed.length) throw new Error("加密图片内容不完整");
  let nonce = "";
  for (let index = 0; index < nonceLength; index += 1) {
    const value = packed[BINARY_SCREENSHOT_MAGIC.length + 1 + index];
    if (value < 0x20 || value > 0x7e) throw new Error("加密图片随机数无效");
    nonce += String.fromCharCode(value);
  }
  if (!privacyService.transformBinaryInPlace(
    packedBuffer,
    "coupon_screenshot",
    nonce,
    payloadOffset,
    packed.length - payloadOffset,
  )) {
    throw new Error("本地图片解密失败");
  }
  return packedBuffer.slice(payloadOffset);
}

function unlinkFile(filePath) {
  return new Promise((resolve) => {
    const fs = getFs();
    if (!fs || !filePath) {
      resolve(false);
      return;
    }
    fs.unlink({
      filePath,
      success() {
        resolve(true);
      },
      fail() {
        resolve(false);
      },
    });
  });
}

function fileExists(filePath) {
  return new Promise((resolve) => {
    const fs = getFs();
    if (!fs || !filePath || typeof fs.stat !== "function") {
      resolve(false);
      return;
    }
    fs.stat({
      path: filePath,
      success() { resolve(true); },
      fail() { resolve(false); },
    });
  });
}

function getFileSize(filePath) {
  return new Promise((resolve) => {
    function statFallback() {
      const fs = getFs();
      if (!fs || typeof fs.stat !== "function") {
        resolve(null);
        return;
      }
      fs.stat({
        path: filePath,
        success(res) {
          const value = Number(
            res && res.stats && res.stats.size !== undefined
              ? res.stats.size
              : res && res.size
          );
          resolve(Number.isFinite(value) && value >= 0 ? value : null);
        },
        fail() { resolve(null); },
      });
    }
    const api = getWx();
    if (api && typeof api.getFileInfo === "function") {
      api.getFileInfo({
        filePath,
        success(res) {
          const value = Number(res && res.size);
          if (Number.isFinite(value) && value >= 0) resolve(value);
          else statFallback();
        },
        fail: statFallback,
      });
      return;
    }
    statFallback();
  });
}

module.exports = {
  readFileArrayBuffer,
  readFileUtf8,
  writeFile,
  packEncryptedScreenshotBuffer,
  hasBinaryScreenshotMagic,
  unpackEncryptedScreenshotBuffer,
  unlinkFile,
  fileExists,
  getFileSize,
};
