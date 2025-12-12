function tryRenderWithJsLenex(lenexObject, options = {}) {
  const { preferManual = false } = options;
  if (preferManual) return null;

  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const lenex = require('js-lenex');
    const builder = lenex?.build ?? lenex?.write ?? lenex?.default ?? lenex;
    if (typeof builder === 'function') {
      return builder(lenexObject);
    }
    if (lenex?.Lenex && typeof lenex.Lenex.toXml === 'function') {
      return lenex.Lenex.toXml(lenexObject);
    }
    return null;
  } catch (error) {
    // Dependency is optional; fall back to manual rendering when it is missing.
    return null;
  }
}

module.exports = { tryRenderWithJsLenex };
