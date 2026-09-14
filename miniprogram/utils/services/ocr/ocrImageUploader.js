/**
 * ocrImageUploader.js
 * 截图与相册选择、云端临时上传与文件清理
 */

const privacyService = require("../../privacyService.js");
const cloudService = require("../cloudService.js");
const { getWx } = require("../../wechatRuntime.js");

const MAX_OCR_UPLOAD_BYTES = 10 * 1024 * 1024;

function getLocalFileSize(api, filePath) {
  return new Promise((resolve) => {
    const statFallback = () => {
      const fs = api && typeof api.getFileSystemManager === "function"
        ? api.getFileSystemManager()
        : null;
      if (!fs || typeof fs.stat !== "function") {
        resolve(null);
        return;
      }
      fs.stat({
        path: filePath,
        success(res) {
          const rawSize = res && res.stats && res.stats.size;
          const size = rawSize !== undefined && rawSize !== null && rawSize !== ""
            ? Number(rawSize)
            : NaN;
          resolve(Number.isFinite(size) && size >= 0 ? size : null);
        },
        fail() { resolve(null); },
      });
    };
    if (!api || typeof api.getFileInfo !== "function") {
      statFallback();
      return;
    }
    api.getFileInfo({
      filePath,
      success(res) {
        const rawSize = res && res.size;
        const size = rawSize !== undefined && rawSize !== null && rawSize !== ""
          ? Number(rawSize)
          : NaN;
        if (Number.isFinite(size) && size >= 0) resolve(size);
        else statFallback();
      },
      fail: statFallback,
    });
  });
}

function validateUploadFile(api, filePath) {
  if (!filePath || typeof filePath !== "string") {
    const error = new Error("没有可上传的图片");
    error.code = "missing_ocr_file";
    return Promise.reject(error);
  }
  return getLocalFileSize(api, filePath).then((size) => {
    if (!Number.isFinite(size) || size <= 0) {
      const error = new Error("无法确认图片大小，请重新选择");
      error.code = "ocr_file_size_unavailable";
      throw error;
    }
    if (size > MAX_OCR_UPLOAD_BYTES) {
      const error = new Error("图片过大，请压缩到 10MB 以内后重试");
      error.code = "ocr_file_too_large";
      throw error;
    }
    return filePath;
  });
}

function chooseImage() {
  return new Promise((resolve, reject) => {
    const api = getWx();
    if (!api) {
      reject(new Error("当前环境不支持选择图片"));
      return;
    }
    if (typeof api.chooseMedia === "function") {
      api.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success(res) {
          const file = res.tempFiles && res.tempFiles[0];
          resolve(file && (file.tempFilePath || file.path));
        },
        fail: reject,
      });
      return;
    }
    api.chooseImage({
      count: 1,
      sourceType: ["album", "camera"],
      success(res) {
        resolve(res.tempFilePaths && res.tempFilePaths[0]);
      },
      fail: reject,
    });
  }).then((path) => {
    if (!path) throw new Error("没有选择图片");
    return path;
  });
}

function uploadImage(tempFilePath) {
  if (!privacyService.isCloudUploadAllowed()) {
    return Promise.reject(privacyService.buildPrivacyBlockedError("隐私模式下不会上传截图进行 OCR，可先添加截图附件或粘贴文字识别。"));
  }
  const cloudError = cloudService.getCloudUnavailableError("截图 OCR");
  if (cloudError) return Promise.reject(cloudError);
  const api = getWx();
  if (!api || !api.cloud || typeof api.cloud.uploadFile !== "function") {
    return Promise.reject(new Error("当前环境不支持云上传"));
  }
  return validateUploadFile(api, tempFilePath).then(() => new Promise((resolve, reject) => {
    // Privacy may be changed while file metadata is being read. Re-check at
    // the last moment before the upload leaves the device.
    if (!privacyService.isCloudUploadAllowed()) {
      reject(privacyService.buildPrivacyBlockedError("隐私模式已开启，截图不会上传。"));
      return;
    }
    const matchedExtension = String(tempFilePath || "").split("?")[0].match(/\.([A-Za-z0-9]+)$/);
    const candidateExtension = matchedExtension ? matchedExtension[1].toLowerCase() : "jpg";
    const suffix = ["jpg", "jpeg", "png", "webp"].includes(candidateExtension) ? candidateExtension : "jpg";
    const nonce = Math.random().toString(36).slice(2, 9);
    api.cloud.uploadFile({
      cloudPath: `ocr/coupon_${Date.now()}_${nonce}.${suffix}`,
      filePath: tempFilePath,
      success(res) {
        resolve(res.fileID);
      },
      fail: reject,
    });
  }));
}

function deleteCloudFile(fileID) {
  const api = getWx();
  // Cleanup must remain best-effort even if the runtime cloud-ready flag or
  // privacy setting changed after a successful upload.
  if (!fileID || !api || !api.cloud || typeof api.cloud.deleteFile !== "function") {
    return Promise.resolve(false);
  }
  return new Promise((resolve, reject) => {
    api.cloud.deleteFile({
      fileList: [fileID],
      success() {
        resolve(true);
      },
      fail: reject,
    });
  });
}

module.exports = {
  MAX_OCR_UPLOAD_BYTES,
  chooseImage,
  uploadImage,
  deleteCloudFile,
};
