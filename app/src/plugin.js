import { Router } from 'express';
import { existsSync } from 'node:fs';
import config from './config.js';

// Serves the bundled WordPress plugin and its update manifest so the plugin can
// auto-update itself via WordPress' native "Update URI" mechanism. The plugin
// (running inside WordPress) polls update-info.json, compares versions, and — if
// the sidecar ships a newer build — pulls the zip from here. Version and
// auto-update policy come from config (package.json / PLUGIN_AUTO_UPDATE).
export function createPluginRouter() {
  const router = Router();

  // Update manifest consumed by the plugin's update_plugins_* filter.
  router.get('/plugin/update-info.json', (_req, res) => {
    res.json({
      name: 'WordPress IDX Search',
      slug: 'wordpress-idx-search',
      version: config.pluginVersion,
      requires: '5.0',
      tested: '6.7',
      requires_php: '7.4',
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
