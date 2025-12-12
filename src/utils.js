const DateTime = {
  asDate(value) {
    if (!value) return undefined;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString().slice(0, 10);
  },
};

module.exports = { DateTime };
