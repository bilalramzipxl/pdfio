const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
// pdf-lib importeert tslib; op web geeft de ESM-wrapper van tslib 'undefined' voor de default-export. Gebruik de echte ES6-build.
const prev = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (platform === 'web' && name === 'tslib') return { type: 'sourceFile', filePath: path.join(__dirname, 'node_modules/tslib/tslib.es6.js') };
  return (prev ?? ctx.resolveRequest)(ctx, name, platform);
};
module.exports = config;
