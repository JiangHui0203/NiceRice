const assert = require("assert");
const path = require("path");

global.wx = {};
global.getApp = () => ({ globalData: {} });

function loadPage(modulePath) {
  let config = null;
  global.Page = (value) => { config = value; };
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  const page = Object.assign({}, config, {
    data: JSON.parse(JSON.stringify(config.data || {})),
  });
  page.setData = (patch) => Object.assign(page.data, patch || {});
  return page;
}

function verifyDismissGesture(page, field, startMethod, moveMethod, endMethod) {
  page.setData({ [field]: true });
  page[startMethod]({ touches: [{ clientX: 10, clientY: 100 }] });
  page[endMethod]({});
  assert.strictEqual(page.data[field], true, "轻触不应关闭抽屉");

  page[startMethod]({ touches: [{ clientX: 10, clientY: 100 }] });
  page[moveMethod]({ touches: [{ clientX: 10, clientY: 200 }] });
  page[endMethod]({});
  assert.strictEqual(page.data[field], false, "超过阈值的下拉应关闭抽屉");
}

const homePage = loadPage(path.join(__dirname, "index/index.js"));
verifyDismissGesture(homePage, "showWeatherDrawer", "onWeatherTouchStart", "onWeatherTouchMove", "onWeatherTouchEnd");

const detailPage = loadPage(path.join(__dirname, "friend-heatmap-detail/index.js"));
verifyDismissGesture(detailPage, "showExportDrawer", "onExportTouchStart", "onExportTouchMove", "onExportTouchEnd");

console.log("drawer dismiss integration tests ok");
