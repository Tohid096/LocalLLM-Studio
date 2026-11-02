// LocalLLM Studio - preload bridge
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // catalog & models
  catalog: () => ipcRenderer.invoke('catalog'),
  modelsList: () => ipcRenderer.invoke('models:list'),
  download: (id) => ipcRenderer.invoke('models:download', id),
  cancelDownload: (id) => ipcRenderer.invoke('models:cancel', id),
  deleteModel: (id) => ipcRenderer.invoke('models:delete', id),
  addLocal: (path, mmproj) => ipcRenderer.invoke('models:addLocal', path, mmproj),
  setMmproj: (id, path) => ipcRenderer.invoke('models:setMmproj', id, path),
  pickFile: (filters) => ipcRenderer.invoke('models:pickFile', filters),
  inspect: (path) => ipcRenderer.invoke('models:inspect', path),

  // engines
  startLLM: (opts) => ipcRenderer.invoke('engine:startLLM', opts),
  stopLLM: () => ipcRenderer.invoke('engine:stopLLM'),
  llamaStatus: () => ipcRenderer.invoke('engine:llamaStatus'),
  chat: (messages, opts) => ipcRenderer.invoke('engine:chat', messages, opts),
  chatStop: () => ipcRenderer.invoke('engine:chatStop'),
  startSD: (entry) => ipcRenderer.invoke('engine:startSD', entry),
  stopSD: () => ipcRenderer.invoke('engine:stopSD'),
  sdStatus: () => ipcRenderer.invoke('engine:sdStatus'),
  sdGen: (params) => ipcRenderer.invoke('engine:sdGen', params),
  sdJob: (id) => ipcRenderer.invoke('engine:sdJob', id),
  sdCancel: (id) => ipcRenderer.invoke('engine:sdCancel', id),
  sdCaps: () => ipcRenderer.invoke('engine:sdCaps'),

  // hardware & settings
  hw: () => ipcRenderer.invoke('hw:detect'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),

  // misc
  saveImage: (b64, name) => ipcRenderer.invoke('app:saveImage', b64, name),
  openFolder: (p) => ipcRenderer.invoke('app:openFolder', p),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  paths: () => ipcRenderer.invoke('app:paths'),

  // projects (multi-file workspace + agent)
  pickFolder: () => ipcRenderer.invoke('project:pickFolder'),
  projectTree: (root) => ipcRenderer.invoke('project:tree', root),
  projectRead: (root, rel) => ipcRenderer.invoke('project:read', root, rel),
  projectWrite: (root, rel, content) => ipcRenderer.invoke('project:write', root, rel, content),
  projectCreate: (root, rel, isDir) => ipcRenderer.invoke('project:create', root, rel, isDir),
  projectDelete: (root, rel) => ipcRenderer.invoke('project:delete', root, rel),
  projectRename: (root, rel, to) => ipcRenderer.invoke('project:rename', root, rel, to),

  // events
  on: (ch, fn) => {
    const subs = {
      'chat-token': fn,
      'llama-log': fn, 'llama-status': fn, 'llama-retry': fn,
      'sd-log': fn, 'sd-status': fn,
      'dl-progress': fn
    };
    const listener = (_e, data) => fn(data);
    ipcRenderer.on(ch, listener);
    return () => ipcRenderer.removeListener(ch, listener);
  }
});
