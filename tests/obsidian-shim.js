// Node shim for the 'obsidian' module, used only by the unit-test bundle
// (esbuild alias). Runtime usage is minimal: type-only imports are erased at
// bundle time; value references like `void TFolder` or the i18n language
// detection tolerate undefined (try/catch).
module.exports = {};
