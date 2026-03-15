const DEFAULT_CONCURRENCY = 1;

const queue = [];
let active = 0;

function getConcurrency() {
  const value = Number(process.env.PROCESSING_CONCURRENCY || DEFAULT_CONCURRENCY);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_CONCURRENCY;
}

function runNext() {
  if (!queue.length) return;
  if (active >= getConcurrency()) return;

  const job = queue.shift();
  if (!job) return;

  active += 1;
  Promise.resolve()
    .then(job.fn)
    .then(job.resolve)
    .catch(job.reject)
    .finally(() => {
      active -= 1;
      setImmediate(runNext);
    });
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    setImmediate(runNext);
  });
}

module.exports = { enqueue };
