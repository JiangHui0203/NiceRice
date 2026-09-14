function mapWithConcurrency(items, limit, worker) {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) return Promise.resolve([]);
  const results = new Array(source.length);
  let cursor = 0;
  let firstError = null;

  function consume() {
    const index = cursor;
    cursor += 1;
    if (index >= source.length) return Promise.resolve();
    return Promise.resolve()
      .then(() => worker(source[index], index))
      .then((value) => { results[index] = value; })
      .catch((error) => { if (!firstError) firstError = error; })
      .then(consume);
  }

  const workers = Array.from({ length: Math.min(Math.max(1, limit), source.length) }, consume);
  return Promise.all(workers).then(() => {
    if (firstError) {
      firstError.partialResults = results.filter(Boolean);
      throw firstError;
    }
    return results;
  });
}

module.exports = { mapWithConcurrency };
