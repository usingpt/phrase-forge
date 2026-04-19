const STORAGE_KEY = "phrase-forge-mvp";

export function createStorage({ cloud } = {}) {
  function loadLocal() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error("Failed to load local data.", error);
      return null;
    }
  }

  function saveLocal(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Failed to save local data.", error);
    }
  }

  async function loadRemote(ownerId) {
    if (!cloud?.enabled || !ownerId) {
      return null;
    }
    try {
      return await cloud.loadWorkspace(ownerId);
    } catch (error) {
      console.error("Failed to load remote workspace.", error);
      return null;
    }
  }

  async function saveRemote(ownerId, workspace) {
    if (!cloud?.enabled || !ownerId) {
      return null;
    }
    try {
      return await cloud.saveWorkspace(ownerId, workspace);
    } catch (error) {
      console.error("Failed to save remote workspace.", error);
      return null;
    }
  }

  function resetWith(state) {
    saveLocal(state);
  }

  return {
    loadLocal,
    saveLocal,
    loadRemote,
    saveRemote,
    resetWith,
  };
}
