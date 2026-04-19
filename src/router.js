export function createRouter({ onRouteChange }) {
  const routes = [
    { name: "home", pattern: /^#\/home$/ },
    { name: "cards", pattern: /^#\/cards$/ },
    { name: "card-new", pattern: /^#\/cards\/new$/ },
    { name: "card-edit", pattern: /^#\/cards\/([^/]+)\/edit$/ },
    { name: "card-detail", pattern: /^#\/cards\/([^/]+)$/ },
    { name: "study", pattern: /^#\/study$/ },
    { name: "settings", pattern: /^#\/settings$/ },
  ];

  function getCurrentRoute() {
    const hash = window.location.hash || "#/home";
    for (const route of routes) {
      const match = hash.match(route.pattern);
      if (!match) {
        continue;
      }
      if (route.name === "card-detail" || route.name === "card-edit") {
        return { name: route.name, params: { cardId: match[1] } };
      }
      return { name: route.name, params: {} };
    }
    return { name: "home", params: {} };
  }

  function navigate(hash) {
    if (window.location.hash === hash) {
      onRouteChange();
      return;
    }
    window.location.hash = hash;
  }

  function start() {
    window.addEventListener("hashchange", onRouteChange);
    if (!window.location.hash) {
      window.location.hash = "#/home";
      return;
    }
    onRouteChange();
  }

  return {
    getCurrentRoute,
    navigate,
    start,
  };
}
