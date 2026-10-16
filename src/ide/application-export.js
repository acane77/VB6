import {download, safeName} from '../core/core.js';
import {exportApplicationFiles, exportApplicationBundle, exportApplicationArchive, verifyApplicationBundle, inspectApplicationExport, createApplicationExporter} from '../exporter/exporter.js';

/** Local download commands; deliberately not arbitrary agent UI commands.
 * Existing MCP export tools keep their consent/revision checks unchanged.
 */
export function installApplicationExport(ide, api) {
  if (ide.applicationExportInstalled) return;
  ide.applicationExportInstalled = true;
  Object.assign(api, {exportApplicationFiles, exportApplicationBundle, exportApplicationArchive, verifyApplicationBundle, inspectApplicationExport, createApplicationExporter});
  let busy = false;
  const menu = ide.menu.bind(ide), command = ide.command.bind(ide);
  ide.menu = name => {
    const items = menu(name);
    if (name === 'File') {
      const index = items.findIndex(item => item?.id === 'exportHTML');
      const enabled = ide.runState === 'design' && !busy;
      items.splice(index + 1, 0,
        {id: 'exportDeployment', label: 'Make Deployment Archive (.zip)…', icon: 'export', enabled},
        {id: 'exportOfflineDeployment', label: 'Make Offline Application (.zip)…', icon: 'export', enabled});
    }
    return items;
  };
  ide.command = async (id, ...args) => {
    if (!['exportDeployment', 'exportOfflineDeployment'].includes(id)) return command(id, ...args);
    if (ide.runState !== 'design') { ide.status('Stop execution before exporting a deployment.'); return; }
    if (busy) {ide.status('A deployment export is already in progress.'); return;}
    busy = true;
    const offline = id === 'exportOfflineDeployment';
    try {
      ide.status('Preparing ' + (offline ? 'offline application' : 'deployment') + ' archive…');
      // Export snapshots project/options synchronously before its first hash;
      // subsequent edits cannot alter the release being prepared.
      const deployment = await exportApplicationArchive(ide.project, {}, {}, {offline});
      download(safeName(deployment.manifest.project.name) + (offline ? '-offline' : '-app') + '.zip', deployment.bytes, 'application/zip');
      ide.lastApplicationExport = deployment.manifest;
      const warnings = deployment.diagnostics.filter(d => d.severity === 'warning').length;
      ide.status('Made ' + (offline ? 'offline application' : 'deployment') + ' archive — ' + Object.keys(deployment.files).length + ' files, ' + Math.round(deployment.bytes.length / 1024) + ' KB.' + (warnings ? ' Review ' + warnings + ' deployment warning(s) in manifest.json.' : ''));
      ide.emit('export', {kind: offline ? 'offline-deployment' : 'deployment', manifest: deployment.manifest});
    } catch (error) {
      ide.lastApplicationExport = {diagnostics: error.diagnostics || [{severity: 'error', message: error.message}]};
      ide.status('Deployment export failed: ' + error.message);
    } finally {busy = false;}
  };
}
