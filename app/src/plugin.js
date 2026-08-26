import { Router } from 'express';
import { existsSync } from 'node:fs';
import config from './config.js';
import { readPluginMeta } from './plugin-meta.js';

// Serves the bundled WordPress plugin and its update manifest so the plugin can
// auto-update itself via WordPress' native "Update URI" mechanism. The plugin
// (running inside WordPress) polls update-info.json, compares versions, and — if
// the sidecar ships a newer build — pulls the zip from here.
//
// The manifest is derived from the packaged plugin's own files, never from this
// service's version: if the two disagree, WordPress installs the package, still
// reads the old version from the header, and re-offers the same update forever.
export function createPluginRouter() {
  const meta = readPluginMeta(config.pluginSrcPath);

  if (!meta.version) {
    console.warn(
      `Plugin metadata not found at ${config.pluginSrcPath}; update endpoint disabled.`,
    );
  } else if (meta.version !== config.version) {
    // Not fatal — the packaged plugin stays authoritative — but it means the
    // release was cut from a tree where sync-version.sh had not been run.
    console.warn(
      `Plugin version ${meta.version} differs from service version ${config.version}.`,
    );
  }

  const router = Router();

  // Update manifest consumed by the plugin's update_plugins_* filter.
  router.get('/plugin/update-info.json', (_req, res) => {
    // Never advertise an update that cannot be installed: without the package
    // (or without readable plugin files) WordPress would loop on a failing
    // download. A non-200 makes the plugin skip the update check entirely.
    if (!meta.version || !existsSync(config.pluginZipPath)) {
      return res.status(503).json({ error: 'Plugin package not bundled in this image.' });
    }

    res.json({
      name: 'WordPress IDX Search',
      slug: 'wordpress-idx-search',
      version: meta.version,
      requires: meta.requires || '',
      tested: meta.tested || '',
      requires_php: meta.requires_php || '',
      auto_update: config.pluginAutoUpdate,
    });
  });

  // The plugin package WordPress downloads when an update is available.
  router.get('/plugin/wordpress-idx-search.zip', (_req, res) => {
    if (!existsSync(config.pluginZipPath)) {
      return res.status(404).json({ error: 'Plugin package not bundled in this image.' });
    }
    res.download(config.pluginZipPath, 'wordpress-idx-search.zip');
  });

  return router;
}
