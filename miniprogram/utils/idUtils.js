const RESERVED_RECORD_IDS = new Set(["__proto__", "constructor", "prototype"]);

function normalizeExactId(value, maxLength = 96) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!id || id !== value || !Number.isSafeInteger(maxLength) || maxLength < 1
    || Array.from(id).length > maxLength || RESERVED_RECORD_IDS.has(id)) return "";
  return id;
}

module.exports = {
  normalizeExactId,
};
