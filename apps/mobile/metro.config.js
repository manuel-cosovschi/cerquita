const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * Metro in a pnpm monorepo.
 *
 * Two things have to be spelled out that a single-package app gets for free:
 *
 * 1. The workspace root is watched, so editing `packages/domain` reloads the
 *    app instead of silently serving a stale bundle.
 * 2. Module resolution. Metro resolves by walking `node_modules` directories
 *    rather than by following the package graph, and pnpm's isolated layout
 *    puts nothing where that walk looks. `.pnpm/node_modules` is where pnpm
 *    places the packages hoisted by `public-hoist-pattern` in .npmrc — the
 *    React Native toolchain — so it is listed explicitly rather than switching
 *    the whole repo to a hoisted linker the API and web apps do not need.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules/.pnpm/node_modules'),
];

// pnpm stores real packages behind symlinks; Metro must follow them rather than
// treat each link as a separate copy of the module.
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
