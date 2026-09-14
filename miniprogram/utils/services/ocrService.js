/**
 * ocrService.js
 * OCR 识别与文本提取门面服务
 * 整合 ocrTextParser (特征提取纯函数) 与 ocrImageUploader (图片选择与云端交互)
 */

const privacyService = require("../privacyService.js");
const cloudService = require("./cloudService.js");
const textParser = require("./ocr/ocrTextParser.js");
const imageUploader = require("./ocr/ocrImageUploader.js");
const { getWx } = require("../wechatRuntime.js");

function callOcr(fileID) {
  return new Promise((resolve, reject) => {
    if (!privacyService.isCloudUploadAllowed()) {
      reject(privacyService.buildPrivacyBlockedError("隐私模式下不会调用云端 OCR。"));
      return;
    }
    const cloudError = cloudService.getCloudUnavailableError("截图 OCR");
    if (cloudError) {
      reject(cloudError);
      return;
    }
    const api = getWx();
    if (!api || !api.cloud || typeof api.cloud.callFunction !== "function") {
      reject(new Error("当前环境不支持云函数"));
      return;
    }
    api.cloud.callFunction({
      name: "lifeServices",
      data: {
        type: "recognizeCouponImage",
        data: { fileID },
      },
      success(res) {
        const result = (res && res.result) || {};
        if (!result.success) {
          const error = new Error(result.message || "OCR 识别失败");
          error.code = result.code || "ocr_failed";
          reject(error);
          return;
        }
        resolve(result);
      },
      fail: reject,
    });
  });
}

function recognizeCouponScreenshot() {
  if (!privacyService.isCloudUploadAllowed()) {
    return Promise.reject(privacyService.buildPrivacyBlockedError("隐私模式下不会上传截图进行 OCR。可以用「添加截图」保存缩略图，或用粘贴文字识别。"));
  }

  const cloudError = cloudService.getCloudUnavailableError("截图 OCR");
  if (cloudError) {
    return Promise.reject(new Error("当前未开通云开发 OCR 识别能力，建议使用「粘贴文字识别」快速录入，截图可作为本地凭证直接保存。"));
  }

  let selectedPath = "";
  let uploadedFileID = "";
  let serverDeletedTemporaryFile = false;
  return imageUploader.chooseImage()
    .then((tempFilePath) => {
      selectedPath = tempFilePath;
      return imageUploader.uploadImage(tempFilePath);
    })
    .then((fileID) => {
      uploadedFileID = fileID;
      return callOcr(fileID).then((result) => {
        serverDeletedTemporaryFile = Boolean(result && result.temporaryFileDeleted);
        return Object.assign({}, result, {
          fileID,
          tempFilePath: selectedPath,
        });
      });
    })
    .finally(() => {
      if (!uploadedFileID || serverDeletedTemporaryFile) return serverDeletedTemporaryFile;
      return imageUploader.deleteCloudFile(uploadedFileID).catch((error) => {
        console.warn("OCR temporary file cleanup failed:", error);
        return false;
      });
    });
}

module.exports = {
  chooseImage: imageUploader.chooseImage,
  uploadImage: imageUploader.uploadImage,
  deleteCloudFile: imageUploader.deleteCloudFile,
  recognizeCouponScreenshot,
  parseCouponText: textParser.parseCouponText,
  ...textParser,
};
