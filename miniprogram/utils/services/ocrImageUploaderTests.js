const assert = require("assert");
const privacyService = require("../privacyService.js");
const cloudService = require("./cloudService.js");

const originals = {
  isCloudUploadAllowed: privacyService.isCloudUploadAllowed,
  getCloudUnavailableError: cloudService.getCloudUnavailableError,
  isCloudReady: cloudService.isCloudReady,
};

privacyService.isCloudUploadAllowed = () => true;
cloudService.getCloudUnavailableError = () => null;
cloudService.isCloudReady = () => true;

const uploadedPaths = [];
global.wx = {
  getFileInfo(options) {
    options.success({ size: 1024 });
  },
  cloud: {
    uploadFile(options) {
      uploadedPaths.push(options.cloudPath);
      options.success({ fileID: `cloud://test/${options.cloudPath}` });
    },
    deleteFile(options) {
      options.success({ fileList: options.fileList });
    },
  },
};

const uploader = require("./ocr/ocrImageUploader.js");

async function run() {
  await uploader.uploadImage("wxfile://tmp/coupon.unsupported?query=1");
  await uploader.uploadImage("wxfile://tmp/coupon.unsupported?query=1");
  assert.match(uploadedPaths[0], /^ocr\/coupon_\d+_[a-z0-9]+\.jpg$/);
  assert.notStrictEqual(uploadedPaths[0], uploadedPaths[1], "concurrent OCR uploads need unique cloud paths");
  assert.strictEqual(await uploader.deleteCloudFile("cloud://test/ocr/coupon_1.jpg"), true);
  assert.strictEqual(await uploader.deleteCloudFile(""), false);

  privacyService.isCloudUploadAllowed = originals.isCloudUploadAllowed;
  cloudService.getCloudUnavailableError = originals.getCloudUnavailableError;
  cloudService.isCloudReady = originals.isCloudReady;
  console.log("ocr image uploader tests ok");
}

run().catch((error) => {
  privacyService.isCloudUploadAllowed = originals.isCloudUploadAllowed;
  cloudService.getCloudUnavailableError = originals.getCloudUnavailableError;
  cloudService.isCloudReady = originals.isCloudReady;
  console.error(error);
  process.exitCode = 1;
});
