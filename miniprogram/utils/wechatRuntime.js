function getWx() {
  return typeof wx === "undefined" ? null : wx;
}

module.exports = { getWx };
