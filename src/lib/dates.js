// Players are in India, so "today" (streaks, daily question) follows IST, not the server's UTC clock.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** YYYY-MM-DD in IST, [daysAgo] days before now. */
function istDate(daysAgo = 0) {
  return new Date(Date.now() + IST_OFFSET_MS - daysAgo * 86400000).toISOString().split('T')[0];
}

module.exports = { istDate };
