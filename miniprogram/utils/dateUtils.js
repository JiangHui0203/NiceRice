function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateAfter(days = 0, baseDate = new Date()) {
  const date = new Date(baseDate.getTime());
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

module.exports = {
  dateAfter,
  formatDate,
  pad,
};
