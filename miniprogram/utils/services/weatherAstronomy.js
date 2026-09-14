/**
 * Pure astronomical helpers used by the weather composition engine.
 */

const DAY_MS = 86400000;
const JULIAN_1970 = 2440588;
const JULIAN_2000 = 2451545;
const OBLIQUITY = 23.4397 * Math.PI / 180;
const RAD = Math.PI / 180;
const SUN_DISTANCE_KM = 149598000;
const SYNODIC_MONTH = 29.53058867;

const PHASES = [
  { phase: "new", phaseLabel: "新月" },
  { phase: "waxing-crescent", phaseLabel: "峨眉月" },
  { phase: "first-quarter", phaseLabel: "上弦月" },
  { phase: "waxing-gibbous", phaseLabel: "盈凸月" },
  { phase: "full", phaseLabel: "满月" },
  { phase: "waning-gibbous", phaseLabel: "亏凸月" },
  { phase: "last-quarter", phaseLabel: "下弦月" },
  { phase: "waning-crescent", phaseLabel: "残月" },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeUnit(value) {
  const normalized = value % 1;
  return normalized < 0 ? normalized + 1 : normalized;
}

function toDays(date) {
  return date.getTime() / DAY_MS - 0.5 + JULIAN_1970 - JULIAN_2000;
}

function rightAscension(longitude, latitude) {
  return Math.atan2(
    Math.sin(longitude) * Math.cos(OBLIQUITY) - Math.tan(latitude) * Math.sin(OBLIQUITY),
    Math.cos(longitude),
  );
}

function declination(longitude, latitude) {
  return Math.asin(
    Math.sin(latitude) * Math.cos(OBLIQUITY)
      + Math.cos(latitude) * Math.sin(OBLIQUITY) * Math.sin(longitude),
  );
}

function getSunCoordinates(days) {
  const meanAnomaly = RAD * (357.5291 + 0.98560028 * days);
  const equationOfCenter = RAD * (
    1.9148 * Math.sin(meanAnomaly)
      + 0.02 * Math.sin(2 * meanAnomaly)
      + 0.0003 * Math.sin(3 * meanAnomaly)
  );
  const perihelion = RAD * 102.9372;
  const longitude = meanAnomaly + equationOfCenter + perihelion + Math.PI;
  return {
    rightAscension: rightAscension(longitude, 0),
    declination: declination(longitude, 0),
  };
}

function getMoonCoordinates(days) {
  const meanLongitude = RAD * (218.316 + 13.176396 * days);
  const meanAnomaly = RAD * (134.963 + 13.064993 * days);
  const argumentOfLatitude = RAD * (93.272 + 13.22935 * days);
  const longitude = meanLongitude + RAD * 6.289 * Math.sin(meanAnomaly);
  const latitude = RAD * 5.128 * Math.sin(argumentOfLatitude);
  return {
    rightAscension: rightAscension(longitude, latitude),
    declination: declination(longitude, latitude),
    distance: 385001 - 20905 * Math.cos(meanAnomaly),
  };
}

function calculateMoonLight(date) {
  const days = toDays(date);
  const sun = getSunCoordinates(days);
  const moon = getMoonCoordinates(days);
  const angularSeparation = Math.acos(clamp(
    Math.sin(sun.declination) * Math.sin(moon.declination)
      + Math.cos(sun.declination) * Math.cos(moon.declination)
        * Math.cos(sun.rightAscension - moon.rightAscension),
    -1,
    1,
  ));
  const incidence = Math.atan2(
    SUN_DISTANCE_KM * Math.sin(angularSeparation),
    moon.distance - SUN_DISTANCE_KM * Math.cos(angularSeparation),
  );
  const brightLimbAngle = Math.atan2(
    Math.cos(sun.declination) * Math.sin(sun.rightAscension - moon.rightAscension),
    Math.sin(sun.declination) * Math.cos(moon.declination)
      - Math.cos(sun.declination) * Math.sin(moon.declination)
        * Math.cos(sun.rightAscension - moon.rightAscension),
  );
  return {
    illumination: clamp((1 + Math.cos(incidence)) / 2, 0, 1),
    phaseProgress: normalizeUnit(
      0.5 + (0.5 * incidence * (brightLimbAngle < 0 ? -1 : 1)) / Math.PI,
    ),
  };
}

function getTimePhase(hour) {
  if (hour >= 5 && hour < 8) return "dawn";       // 5:00 - 7:59 清晨
  if (hour >= 8 && hour < 12) return "morning";    // 8:00 - 11:59 上午
  if (hour >= 12 && hour < 14) return "noon";      // 12:00 - 13:59 中午
  if (hour >= 14 && hour < 18) return "afternoon"; // 14:00 - 17:59 下午
  if (hour >= 18 && hour < 20) return "evening";   // 18:00 - 19:59 傍晚
  if (hour >= 20 && hour < 24) return "night";     // 20:00 - 23:59 夜晚
  return "lateNight";                              // 0:00 - 4:59 深夜
}

function getLunarMoonPhase(date = new Date()) {
  const parsed = date instanceof Date ? date : new Date(date);
  const d = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const light = calculateMoonLight(d);
  const phaseIndex = Math.floor(normalizeUnit(light.phaseProgress + 1 / 16) * 8) % 8;
  const matched = PHASES[phaseIndex];
  const moonAge = light.phaseProgress * SYNODIC_MONTH;

  return {
    moonAge: Math.round(moonAge * 10) / 10,
    phase: matched.phase,
    phaseLabel: matched.phaseLabel,
    illumination: Math.round(light.illumination * 1000) / 1000,
    phaseProgress: Math.round(light.phaseProgress * 100000) / 100000,
    phaseAngle: Math.round(light.phaseProgress * 3600) / 10,
    waxing: light.phaseProgress > 0 && light.phaseProgress < 0.5,
  };
}

module.exports = {
  getLunarMoonPhase,
  getTimePhase,
};
