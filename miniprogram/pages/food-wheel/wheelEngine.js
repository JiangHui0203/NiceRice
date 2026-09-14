/**
 * wheelEngine.js
 * 今天吃啥大转盘引擎门面。
 *
 * 保留原有导出契约，具体职责由 engine/ 下的纯模块承载。
 */

const wheelPhysics = require("./engine/wheelPhysics.js");
const confettiEngine = require("./engine/confettiEngine.js");
const wheelCandidateHelper = require("./engine/wheelCandidateHelper.js");
const wheelShareHelper = require("./engine/wheelShareHelper.js");

module.exports = {
  morandiPresets: wheelPhysics.morandiPresets,
  calculateWheelSlices: wheelPhysics.calculateWheelSlices,
  computeTargetAngle: wheelPhysics.computeTargetAngle,
  createConfettiParticles: confettiEngine.createConfettiParticles,
  updateAndRenderConfetti: confettiEngine.updateAndRenderConfetti,
  buildCategoryFilters: wheelCandidateHelper.buildCategoryFilters,
  filterWheelCandidates: wheelCandidateHelper.filterWheelCandidates,
  buildFilterSummary: wheelCandidateHelper.buildFilterSummary,
  SCENARIO_PACKS: wheelCandidateHelper.SCENARIO_PACKS,
  buildWheelShareData: wheelShareHelper.buildWheelShareData,
};
