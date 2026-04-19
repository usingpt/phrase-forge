const STORAGE_KEY = "phrase-forge-mvp";

export function createStorage() {
  function load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error("Failed to load local data.", error);
      return null;
    }
  }

  function save(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Failed to save local data.", error);
    }
  }

  function resetWith(state) {
    save(state);
  }

  return {
    load,
    save,
    resetWith,
  };
}
