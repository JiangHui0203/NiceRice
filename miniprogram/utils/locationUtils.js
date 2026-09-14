function normalizeCoordinate(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isValidLatitude(value) {
  const latitude = normalizeCoordinate(value);
  return latitude !== null && latitude >= -90 && latitude <= 90;
}

function isValidLongitude(value) {
  const longitude = normalizeCoordinate(value);
  return longitude !== null && longitude >= -180 && longitude <= 180;
}

function hasCoordinates(location = {}) {
  const latitude = location.latitude !== undefined ? location.latitude : location.lat;
  const longitude = location.longitude !== undefined ? location.longitude : location.lng;
  return isValidLatitude(latitude) && isValidLongitude(longitude);
}

module.exports = {
  hasCoordinates,
  isValidLatitude,
  isValidLongitude,
  normalizeCoordinate,
};
