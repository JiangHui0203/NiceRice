const { getUserDataPath } = require("./screenshotContext.js");

function getDirectChildName(filePath, rootPath) {
  const value = String(filePath || "");
  const root = String(rootPath || "").replace(/\/+$/, "");
  const prefix = root ? `${root}/` : "";
  if (!prefix || value.indexOf(prefix) !== 0) return "";
  const name = value.slice(prefix.length);
  if (!name || name.length > 240 || name === "." || name === ".."
    || /[\\/\u0000-\u001f\u007f]/.test(name)) return "";
  return name;
}

function getManagedFileName(filePath, pattern) {
  const roots = [getUserDataPath(), "wxfile://usr"].filter((root, index, list) => (
    root && list.indexOf(root) === index
  ));
  for (let index = 0; index < roots.length; index += 1) {
    const name = getDirectChildName(filePath, roots[index]);
    if (name && pattern.test(name)) return name;
  }
  return "";
}

function getManagedPreviewFileName(filePath) {
  return getManagedFileName(filePath, /^preview_[A-Za-z0-9][A-Za-z0-9._-]{0,231}$/);
}

function isManagedPreviewPath(filePath) {
  return Boolean(getManagedPreviewFileName(filePath));
}

function getManagedStoredFileName(filePath) {
  return getManagedFileName(
    filePath,
    /^(?:shot_|coupon_screenshot_)[A-Za-z0-9][A-Za-z0-9._-]{0,221}$/,
  );
}

function isManagedStoredPath(filePath) {
  return Boolean(getManagedStoredFileName(filePath));
}

function getManagedStoredPathKey(filePath) {
  const name = getManagedStoredFileName(filePath);
  return name ? `stored:${name}` : "";
}

module.exports = {
  getDirectChildName,
  getManagedFileName,
  getManagedPreviewFileName,
  isManagedPreviewPath,
  getManagedStoredFileName,
  isManagedStoredPath,
  getManagedStoredPathKey,
};
