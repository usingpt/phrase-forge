import { createRouter } from "./router.js";
import { createStore } from "./state/store.js";
import { createFlashcardGenerationService } from "./services/flashcardGenerationService.js";
import { createStorage } from "./services/storage.js";
import { loadAppConfig } from "./services/appConfigService.js";
import { createCloudService } from "./services/cloudService.js";
import { formatDateTime } from "./utils/formatters.js";

const CARD_TYPES = [
  { value: "idiom", label: "Idiom" },
  { value: "phrase", label: "Phrase" },
];

const CONFIDENCE_LEVELS = [
  { value: "", label: "All" },
  { value: "0", label: "Unrated" },
  { value: "1", label: "Star 1" },
  { value: "2", label: "Star 2" },
  { value: "3", label: "Star 3" },
];

const GUEST_OWNER_ID = "guest-local";

export async function createApp(rootElement) {
  rootElement.innerHTML = `
    <div class="app-shell">
      <main class="content">
        <section class="panel">
          <p>Loading Phrase Forge...</p>
        </section>
      </main>
    </div>
  `;

  const appConfig = await loadAppConfig();
  const cloud = await createCloudService(appConfig);
  const store = createStore({
    storage: createStorage({ cloud }),
    defaultOpenAiModel: appConfig.openAiModel,
  });
  const generator = createFlashcardGenerationService();
  const router = createRouter({ onRouteChange: render });
  let flashMessage = "";
  let authReady = false;

  await store.updateCurrentUser(await cloud.getCurrentUser());

  cloud.onAuthStateChange(async (user) => {
    if (!authReady) {
      return;
    }

    const previousUserId = store.getState().settings.currentUser?.id || "";
    const nextUserId = user?.id || "";
    await store.updateCurrentUser(user);

    if (previousUserId !== nextUserId) {
      flashMessage = user ? "Signed in with Google." : "Signed out.";
    }

    render();
  });

  function render() {
    const route = router.getCurrentRoute();
    const state = store.getState();
    const ownerId = getOwnerId(state);
    const user = state.settings.currentUser;
    const languagePairs = visibleLanguagePairs(state, ownerId);
    const currentPair = getCurrentPair(languagePairs, state.settings.activePairId);
    const cards = visibleCards(state, ownerId);
    const cardsForCurrentPair = cardsForPair(cards, currentPair?.id);

    rootElement.innerHTML = layout(route, user, languagePairs, currentPair, cards);
    bindRoutes();
    bindFlash();
    renderView(route, state, { ownerId, user, languagePairs, currentPair, cards, cardsForCurrentPair, state });
    bindGlobalUi();
  }

  function layout(route, user, languagePairs, currentPair, cards) {
    const stats = summarizeCards(cards, currentPair?.id);

    return `
      <div class="app-shell">
        <header class="app-header">
          <div class="header-main">
            <div class="brand-block">
              <a class="brand brand-link" href="#/home" data-route>Phrase Forge</a>
            </div>
            <div class="header-stats">
              <span class="header-stat"><span class="header-stat-label">User</span><strong>${esc(user?.name || "Guest")}</strong></span>
              <span class="header-stat"><span class="header-stat-label">Cards</span><strong>${stats.total}</strong></span>
              <span class="header-stat"><span class="header-stat-label">Stars 1-2</span><strong>${stats.confidence[1] + stats.confidence[2]}</strong></span>
            </div>
            <div class="header-actions">
              ${languagePairs.length ? `
                <label class="field pair-switcher compact-field">
                  <select id="pair-switcher">
                    ${languagePairs.map((pair) => `<option value="${pair.id}" ${pair.id === currentPair?.id ? "selected" : ""}>${esc(pairLabel(pair))}</option>`).join("")}
                  </select>
                </label>
              ` : ""}
              <div class="auth-slot">
                ${user ? authBadge(user) : cloud.enabled ? '<button type="button" class="button button-secondary auth-button" id="sign-in-button">Sign in with Google</button>' : '<span class="header-note">Local mode</span>'}
              </div>
              <button type="button" class="menu-button" id="menu-toggle" aria-expanded="false" aria-controls="header-menu">
                <span></span><span></span><span></span>
              </button>
            </div>
          </div>
          <nav class="header-menu" id="header-menu" hidden>
            ${nav("#/home", "Home", route.name === "home")}
            ${nav("#/cards", "Cards", ["cards", "card-new", "card-detail", "card-edit"].includes(route.name))}
            ${nav("#/study", "Study Mode", route.name === "study")}
            ${nav("#/settings", "Settings", route.name === "settings")}
            <a class="nav-link buttonlike" href="#/cards/new" data-route>Add Card</a>
            ${user ? `<button type="button" class="nav-link nav-button" id="sign-out-button">Sign out</button>` : ""}
          </nav>
        </header>

        <main class="content">
          <section class="page-head">
            <div>
              <p class="eyebrow">Flashcards</p>
              <h1>${pageTitle(route)}</h1>
            </div>
          </section>

          <div id="flash-region">${flashMessage ? `<div class="flash-message">${esc(flashMessage)}</div>` : ""}</div>
          <section id="view"></section>
        </main>
      </div>
    `;
  }

  function bindRoutes() {
    rootElement.querySelectorAll("[data-route]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        const href = event.currentTarget.getAttribute("href");
        if (href) {
          router.navigate(href);
        }
      });
    });
  }

  function bindGlobalUi() {
    const menuButton = rootElement.querySelector("#menu-toggle");
    const menu = rootElement.querySelector("#header-menu");
    if (menuButton && menu) {
      menuButton.addEventListener("click", () => {
        const expanded = menuButton.getAttribute("aria-expanded") === "true";
        menuButton.setAttribute("aria-expanded", String(!expanded));
        menu.hidden = expanded;
      });
    }

    const pairSwitcher = rootElement.querySelector("#pair-switcher");
    if (pairSwitcher) {
      pairSwitcher.addEventListener("change", async (event) => {
        await store.updateActivePair(event.currentTarget.value);
        render();
      });
    }

    const signInButton = rootElement.querySelector("#sign-in-button");
    if (signInButton) {
      signInButton.addEventListener("click", async () => {
        try {
          await cloud.signInWithGoogle();
        } catch (error) {
          alert(error?.message || "Google sign-in could not be started.");
        }
      });
    }

    const signOutButton = rootElement.querySelector("#sign-out-button");
    if (signOutButton) {
      signOutButton.addEventListener("click", async () => {
        try {
          await cloud.signOut();
          await store.updateCurrentUser(null);
          showFlash("Signed out.");
        } catch (error) {
          alert(error?.message || "Sign-out failed.");
        }
      });
    }
  }

  function bindFlash() {
    const flash = rootElement.querySelector(".flash-message");
    if (!flashMessage || !flash) {
      return;
    }
    window.clearTimeout(bindFlash.timeoutId);
    bindFlash.timeoutId = window.setTimeout(() => {
      flashMessage = "";
      render();
    }, 2400);
  }

  function showFlash(message) {
    flashMessage = message;
    render();
  }

  function showInlineFlash(message) {
    flashMessage = message;
    const region = rootElement.querySelector("#flash-region");
    if (region) {
      region.innerHTML = `<div class="flash-message">${esc(flashMessage)}</div>`;
      window.clearTimeout(showInlineFlash.timeoutId);
      showInlineFlash.timeoutId = window.setTimeout(() => {
        flashMessage = "";
        const currentRegion = rootElement.querySelector("#flash-region");
        if (currentRegion) {
          currentRegion.innerHTML = "";
        }
      }, 2400);
    }
  }

  function navigateWithFlash(hash, message) {
    flashMessage = message;
    router.navigate(hash);
  }

  function renderView(route, state, context) {
    const view = rootElement.querySelector("#view");
    if (route.name === "home") return renderHome(view, context);
    if (route.name === "cards") return renderCards(view, context);
    if (route.name === "card-new") return renderCardForm(view, state, context);
    if (route.name === "card-edit") return renderCardForm(view, state, context, route.params.cardId);
    if (route.name === "card-detail") return renderCardDetail(view, state, context, route.params.cardId);
    if (route.name === "study") return renderStudy(view, context);
    if (route.name === "settings") return renderSettings(view, state, context);
    router.navigate("#/home");
  }

  function renderHome(view, context) {
    const latestCards = cardsForPair(context.cards, context.currentPair?.id).slice(0, 4);
    const topTags = summarizeTopTags(context.cardsForCurrentPair, context.state?.settings?.homeTagLimit || 5);

    view.innerHTML = `
      <section class="stack">
        <div class="hero-panel hero-gradient hero-actions-only">
          <div class="hero-actions">
            <a class="button button-primary" href="#/cards/new" data-route>Add Card</a>
            <a class="button button-secondary" href="#/cards" data-route>Cards</a>
            <a class="button button-secondary" href="#/study" data-route>Study Mode</a>
          </div>
        </div>

        ${topTags.length ? `
          <section class="panel">
            <div class="tag-shortcuts">
              ${topTags.map((item) => `<button type="button" class="tag-shortcut-button" data-home-tag="${esc(item.tag)}">${esc(item.tag)}</button>`).join("")}
            </div>
          </section>
        ` : ""}

        <section class="panel">
          <div class="list-stack">
            ${latestCards.length ? latestCards.map(homeCardRow).join("") : `<div class="empty-state">No cards yet. Add a card from the menu to get started.</div>`}
          </div>
        </section>
      </section>
    `;

    view.querySelectorAll("[data-home-tag]").forEach((button) => {
      button.addEventListener("click", (event) => {
        writeCardsFilterState({
          query: "",
          type: "",
          tag: event.currentTarget.getAttribute("data-home-tag") || "",
          confidence: "",
        });
        router.navigate("#/cards");
      });
    });
  }

  function renderCards(view, context) {
    const savedFilters = readCardsFilterState();
    const filtersCollapsed = readCardsFilterCollapsed();
    view.innerHTML = `
      <section class="panel">
        <div class="section-head">
          <div></div>
          <div class="card-actions">
            <a class="button button-primary" href="#/cards/new" data-route>Add Card</a>
            <button type="button" class="button button-secondary" id="toggle-filters">${filtersCollapsed ? "Show Filters" : "Hide Filters"}</button>
          </div>
        </div>
        <div class="toolbar toolbar-4 ${filtersCollapsed ? "is-collapsed" : ""}" id="cards-toolbar">
          <label class="field"><span>Search</span><input id="search" type="search" placeholder="Search expressions, examples, translations, or nuance" /></label>
          <label class="field"><span>Type</span><select id="type-filter"><option value="">All</option>${CARD_TYPES.map((type) => `<option value="${type.value}">${type.label}</option>`).join("")}</select></label>
          <label class="field"><span>Tags</span><select id="tag-filter"><option value="">All</option>${uniqueTags(context.cardsForCurrentPair).map((tag) => `<option value="${esc(tag)}">${esc(tag)}</option>`).join("")}</select></label>
          <label class="field"><span>Confidence</span><select id="confidence-filter">${CONFIDENCE_LEVELS.map((level) => `<option value="${level.value}">${level.label}</option>`).join("")}</select></label>
        </div>
        <div id="card-list" class="card-grid"></div>
      </section>
    `;

    const search = view.querySelector("#search");
    const type = view.querySelector("#type-filter");
    const tag = view.querySelector("#tag-filter");
    const confidence = view.querySelector("#confidence-filter");
    const toggleFilters = view.querySelector("#toggle-filters");
    const toolbar = view.querySelector("#cards-toolbar");

    search.value = savedFilters.query;
    type.value = savedFilters.type;
    tag.value = savedFilters.tag;
    confidence.value = savedFilters.confidence;

    toggleFilters.addEventListener("click", () => {
      const collapsed = toolbar.classList.toggle("is-collapsed");
      writeCardsFilterCollapsed(collapsed);
      toggleFilters.textContent = collapsed ? "Show Filters" : "Hide Filters";
    });

    const update = () => {
      writeCardsFilterState({
        query: search.value,
        type: type.value,
        tag: tag.value,
        confidence: confidence.value,
      });
      const items = filterCards(context.cards, {
        query: search.value,
        type: type.value,
        tag: tag.value,
        confidence: confidence.value,
        pairId: context.currentPair?.id || "",
      });
      view.querySelector("#card-list").innerHTML = items.length
        ? items.map(cardPreview).join("")
        : `<div class="empty-state">No cards match the current filters. Try broadening your search.</div>`;
      bindRoutes();
      bindConfidenceButtons(view);
      bindCardDeleteButtons(view);
    };

    search.addEventListener("input", update);
    type.addEventListener("change", update);
    tag.addEventListener("change", update);
    confidence.addEventListener("change", update);
    update();
  }

  function renderCardForm(view, state, context, cardId = null) {
    const editingCard = cardId ? getCardById(context.cards, cardId) : null;
    if (cardId && !editingCard) {
      navigateWithFlash("#/cards", "Card not found, so you were returned to the list.");
      return;
    }

    const draft = !editingCard ? readDraftFromSession() : null;
    const initialType = editingCard?.type || draft?.type || "idiom";

    view.innerHTML = `
      <section class="panel">
        <div class="section-head">
          <div></div>
          <div class="card-actions">
            <button type="button" id="generate-button-top" class="button button-secondary">Generate</button>
            <button type="submit" form="card-form" class="button button-primary">Save</button>
          </div>
        </div>
        <form id="card-form" class="form-grid">
          <label class="field">
            <span>Language Pair *</span>
            <select name="pairId" required>
              ${context.languagePairs.map((pair) => `<option value="${pair.id}" ${pair.id === (editingCard?.pairId || draft?.pairId || context.currentPair?.id) ? "selected" : ""}>${esc(pairLabel(pair))}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>Card Type *</span>
            <select name="type" required>
              ${CARD_TYPES.map((type) => `<option value="${type.value}" ${type.value === initialType ? "selected" : ""}>${type.label}</option>`).join("")}
            </select>
          </label>
          ${input("expression", "Expression", true, "e.g. be in luck")}
          ${input("translation", "Translation", false, "For phrases")}
          ${input("tags", "Tags", false, "e.g. daily conversation, travel, movies")}
          ${textarea("meaning", "Meaning", "For idioms")}
          ${textarea("example", "Example", "For idioms")}
          ${textarea("exampleTranslation", "Example Translation", "For idioms")}
          ${textarea("nuance", "Nuance", "For idioms / optional note for phrases")}
          ${textarea("notes", "Notes / Origin", "For phrases")}
          <label class="field">
            <span>Confidence</span>
            <select name="confidence">
              <option value="0">Unrated</option>
              <option value="1">Star 1</option>
              <option value="2">Star 2</option>
              <option value="3">Star 3</option>
            </select>
          </label>
        </form>
      </section>
    `;

    if (editingCard) {
      fillCardForm(view, editingCard);
    } else if (draft) {
      fillCardForm(view, { ...createEmptyCard(context.currentPair?.id), ...draft });
    } else {
      fillCardForm(view, createEmptyCard(context.currentPair?.id));
    }

    syncTypeHints(view.querySelector("#card-form"));
    view.querySelector('[name="type"]').addEventListener("change", (event) => {
      syncTypeHints(event.currentTarget.form);
    });

    view.querySelector("#card-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const card = collectCardForm(event.currentTarget);
      if (!card.expression) {
        alert("Expression is required.");
        return;
      }
      if (editingCard) {
        await store.updateCard(editingCard.id, card);
        sessionStorage.removeItem("phrase-forge:draft");
        navigateWithFlash(`#/cards/${editingCard.id}`, "Card updated.");
        return;
      }
      const created = await store.addCard(card);
      sessionStorage.removeItem("phrase-forge:draft");
      navigateWithFlash(`#/cards/${created.id}`, "Card saved.");
    });

    view.querySelector("#generate-button-top").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const form = view.querySelector("#card-form");
      const partial = collectCardForm(form);
      if (!partial.expression) {
        alert("Enter an expression first.");
        return;
      }
      if (!appConfig.features.sharedGeneration) {
        alert("Shared OpenAI generation is not configured on the server yet.");
        return;
      }

      button.disabled = true;
      button.textContent = "Generating...";

      try {
        const pair = getPairById(context.languagePairs, partial.pairId) || context.currentPair;
        const generated = await generator.generateDraft({
          model: state.settings.openAiModel,
          nativeLanguage: pair?.nativeLanguage || "Japanese",
          targetLanguage: pair?.targetLanguage || "English",
          type: partial.type,
          expression: partial.expression,
        });

        fillCardForm(view, {
          ...partial,
          ...generated,
          tags: mergeTags(partial.tags, generated.tags || []),
        });
        syncTypeHints(form);
        showInlineFlash("A draft was generated. Adjust it if needed, then save.");
      } catch (error) {
        alert(formatApiError(error));
      } finally {
        button.disabled = false;
        button.textContent = "Generate";
      }
    });
  }

  function renderCardDetail(view, state, context, cardId) {
    const card = getCardById(context.cards, cardId);
    if (!card) {
      navigateWithFlash("#/cards", "Card not found, so you were returned to the list.");
      return;
    }

    const pair = getPairById(context.languagePairs, card.pairId) || context.currentPair;

    view.innerHTML = `
      <section class="stack">
        <div class="hero-panel hero-gradient">
          <div>
            <p class="eyebrow">${esc(card.type === "idiom" ? "Idiom" : "Phrase")} / ${esc(pairLabel(pair))}</p>
            <h2>${esc(card.expression)}</h2>
            <div class="confidence-row">
              <span>Confidence</span>
              <div class="star-group">${renderStarButtons(card.id, card.confidence, true)}</div>
            </div>
          </div>
          <div class="hero-actions">
            <a class="button button-secondary" href="#/cards" data-route>Back to List</a>
            <a class="button button-primary" href="#/cards/${card.id}/edit" data-route>Edit</a>
            <button id="delete-card-button" type="button" class="button button-secondary">Delete</button>
          </div>
        </div>

        <div class="grid-2">
          <section class="panel">
            <h3>Meaning and Notes</h3>
            ${definition("Translation", card.translation)}
            ${definition("Meaning", card.meaning)}
            ${definition("Nuance", card.nuance)}
            ${definition("Notes / Origin", card.notes)}
          </section>
          <section class="panel">
            <h3>Example</h3>
            ${richDefinition("Example", highlightExpression(card.example, card.expression, card.type))}
            ${definition("Example Translation", card.exampleTranslation)}
            ${definition("Tags", card.tags.join(", "))}
            ${definition("Updated", formatDateTime(card.updatedAt))}
          </section>
        </div>
      </section>
    `;

    view.querySelector("#delete-card-button").addEventListener("click", async () => {
      if (!confirm(`Delete "${card.expression}"?`)) {
        return;
      }
      await store.deleteCard(card.id);
      navigateWithFlash("#/cards", "Card deleted.");
    });

    bindConfidenceButtons(view);
  }

  function renderStudy(view, context) {
    const allTags = uniqueTags(context.cardsForCurrentPair);
    const selectedTag = sessionStorage.getItem("phrase-forge:study-tag") || "";
    const studyCards = filterStudyCards(context.cardsForCurrentPair, selectedTag);
    let currentIndex = clampIndex(Number(sessionStorage.getItem("phrase-forge:study-index") || 0), studyCards.length);
    let revealed = false;

    view.innerHTML = `
      <section class="stack">
        <section class="panel">
          <div class="section-head">
            <div></div>
          </div>
          <form id="study-filter-form" class="inline-form study-filter-form">
            <label class="field">
              <span>Study Tag</span>
              <select name="tag">
                <option value="">All</option>
                ${allTags.map((tag) => `<option value="${esc(tag)}" ${tag === selectedTag ? "selected" : ""}>${esc(tag)}</option>`).join("")}
              </select>
            </label>
            <button type="submit" class="button button-secondary">Update Filters</button>
          </form>
        </section>
        <div id="study-region"></div>
      </section>
    `;

    const studyRegion = view.querySelector("#study-region");

    const draw = () => {
      const cards = filterStudyCards(context.cardsForCurrentPair, sessionStorage.getItem("phrase-forge:study-tag") || "");
      if (!cards.length) {
        studyRegion.innerHTML = `<div class="empty-state">No study cards match the current filters.</div>`;
        return;
      }

      currentIndex = clampIndex(currentIndex, cards.length);
      const card = cards[currentIndex];
      studyRegion.innerHTML = `
        <section class="study-card ${revealed ? "is-revealed" : ""}" id="study-card">
          <div class="study-meta">
            <span>${currentIndex + 1} / ${cards.length}</span>
            <span>${esc(pairLabel(getPairById(context.languagePairs, card.pairId) || context.currentPair))}</span>
          </div>
          <div class="study-front">
            <p class="study-expression">${esc(card.expression)}</p>
            <div class="study-example">${highlightExpression(card.example || card.expression, card.expression, card.type)}</div>
          </div>
          <div class="study-back ${revealed ? "is-visible" : ""}">
            <dl class="study-definition">
              <dt>Translation</dt>
              <dd>${esc(card.translation || card.meaning || "Not entered")}</dd>
              <dt>Nuance</dt>
              <dd>${esc(card.nuance || card.notes || "Not entered")}</dd>
            </dl>
          </div>
          <div class="study-actions">
            <button type="button" class="button button-secondary" id="prev-card">Previous</button>
            <div class="confidence-row">
              <span>Confidence</span>
              <div class="star-group">${renderStarButtons(card.id, card.confidence, true)}</div>
            </div>
            <button type="button" class="button button-primary" id="next-card">Next</button>
          </div>
        </section>
      `;

      const studyCard = studyRegion.querySelector("#study-card");
      studyCard.addEventListener("click", (event) => {
        if (event.target.closest("button")) {
          return;
        }
        revealed = !revealed;
        draw();
      });

      studyRegion.querySelector("#prev-card").addEventListener("click", () => {
        currentIndex = currentIndex === 0 ? cards.length - 1 : currentIndex - 1;
        sessionStorage.setItem("phrase-forge:study-index", String(currentIndex));
        revealed = false;
        draw();
      });

      studyRegion.querySelector("#next-card").addEventListener("click", () => {
        currentIndex = currentIndex === cards.length - 1 ? 0 : currentIndex + 1;
        sessionStorage.setItem("phrase-forge:study-index", String(currentIndex));
        revealed = false;
        draw();
      });

      bindConfidenceButtons(studyRegion);
    };

    view.querySelector("#study-filter-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      sessionStorage.setItem("phrase-forge:study-tag", data.get("tag")?.toString() || "");
      sessionStorage.setItem("phrase-forge:study-index", "0");
      currentIndex = 0;
      revealed = false;
      draw();
    });

    draw();
  }

  function renderSettings(view, state, context) {
    const editingPairId = sessionStorage.getItem("phrase-forge:editing-pair") || "";
    const editingPair = editingPairId ? getPairById(context.languagePairs, editingPairId) : null;

    view.innerHTML = `
      <section class="stack">
        <section class="panel">
          <div class="section-head">
            <div></div>
          </div>
          <form id="settings-form" class="form-grid">
            ${input("openAiModel", "OpenAI Model", true, "e.g. gpt-4.1-mini")}
            ${input("homeTagLimit", "Home Tags Limit", true, "e.g. 5", "number")}
            <div class="field span-2">
              <span>Cloud Setup</span>
              <div class="settings-note">${appConfig.features.cloudSync ? "Cards are synced with Supabase for signed-in users." : "Supabase is not configured yet. Cards stay local until SUPABASE_URL and SUPABASE_ANON_KEY are set in Vercel."}</div>
            </div>
            <div class="field span-2">
              <span>Shared AI</span>
              <div class="settings-note">${appConfig.features.sharedGeneration ? "OpenAI generation is managed server-side through Vercel environment variables." : "Shared OpenAI generation is not configured yet. Add OPENAI_API_KEY in Vercel to enable it."}</div>
            </div>
            <div class="form-actions">
              <button type="submit" class="button button-primary">Save Settings</button>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="section-head">
            <div></div>
          </div>
          <div class="list-stack">
            ${context.languagePairs.map((pair) => `
              <article class="person-row">
                <div>
                  <strong>${esc(pairLabel(pair))}</strong>
                  <p>${pair.id === context.currentPair?.id ? "Currently selected." : "Available to switch."}</p>
                </div>
                <div class="row-actions">
                  <button type="button" class="button button-secondary" data-activate-pair="${pair.id}">Switch</button>
                  <button type="button" class="button button-secondary" data-edit-pair="${pair.id}">Edit</button>
                  <button type="button" class="button button-secondary" data-delete-pair="${pair.id}">Delete</button>
                </div>
              </article>
            `).join("")}
          </div>
          <form id="pair-form" class="form-grid with-top-gap">
            <input type="hidden" name="pairId" value="${esc(editingPair?.id || "")}" />
            ${input("pairName", "Display Name", false, "e.g. Japanese -> English")}
            ${input("nativeLanguage", "Native Language", true, "e.g. Japanese")}
            ${input("targetLanguage", "Target Language", true, "e.g. English")}
            <div class="form-actions">
              <button type="submit" class="button button-secondary">${editingPair ? "Update Language Pair" : "Add Language Pair"}</button>
              ${editingPair ? '<button type="button" class="button button-secondary" id="cancel-pair-edit">Cancel Edit</button>' : ""}
            </div>
          </form>
        </section>
      </section>
    `;

    setValue(view, "openAiModel", state.settings.openAiModel);
    setValue(view, "homeTagLimit", String(state.settings.homeTagLimit || 5));
    if (editingPair) {
      setValue(view, "pairName", editingPair.name);
      setValue(view, "nativeLanguage", editingPair.nativeLanguage);
      setValue(view, "targetLanguage", editingPair.targetLanguage);
    }

    view.querySelectorAll("[data-activate-pair]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        await store.updateActivePair(event.currentTarget.getAttribute("data-activate-pair"));
        showFlash("Language pair switched.");
      });
    });

    view.querySelectorAll("[data-edit-pair]").forEach((button) => {
      button.addEventListener("click", (event) => {
        sessionStorage.setItem("phrase-forge:editing-pair", event.currentTarget.getAttribute("data-edit-pair"));
        render();
      });
    });

    view.querySelectorAll("[data-delete-pair]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const pairId = event.currentTarget.getAttribute("data-delete-pair");
        const pair = getPairById(context.languagePairs, pairId);
        if (!pair) {
          return;
        }
        if (!confirm(`Delete "${pairLabel(pair)}"? Cards in this language pair will also be deleted.`)) {
          return;
        }
        const result = await store.deleteLanguagePair(pairId);
        if (!result?.ok) {
          if (result?.reason === "last_pair") {
            alert("You cannot delete the last remaining language pair.");
            return;
          }
          alert("Could not delete the language pair.");
          return;
        }
        if (editingPairId === pairId) {
          sessionStorage.removeItem("phrase-forge:editing-pair");
        }
        showFlash("Language pair deleted.");
      });
    });

    const cancelButton = view.querySelector("#cancel-pair-edit");
    if (cancelButton) {
      cancelButton.addEventListener("click", () => {
        sessionStorage.removeItem("phrase-forge:editing-pair");
        render();
      });
    }

    view.querySelector("#pair-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const input = {
        name: data.get("pairName")?.toString().trim(),
        nativeLanguage: data.get("nativeLanguage")?.toString().trim(),
        targetLanguage: data.get("targetLanguage")?.toString().trim(),
      };
      const pairId = data.get("pairId")?.toString().trim();
      if (pairId) {
        const updated = await store.updateLanguagePair(pairId, input);
        if (!updated) {
          alert("Could not update the language pair.");
          return;
        }
        await store.updateActivePair(updated.id);
        sessionStorage.removeItem("phrase-forge:editing-pair");
        showFlash("Language pair updated.");
        return;
      }
      const pair = await store.addLanguagePair(input);
      await store.updateActivePair(pair.id);
      showFlash("Language pair added.");
    });

    view.querySelector("#settings-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await store.updateSettings({
        openAiModel: data.get("openAiModel")?.toString().trim(),
        homeTagLimit: data.get("homeTagLimit")?.toString().trim(),
      });
      showFlash("Settings saved.");
    });
  }

  function bindConfidenceButtons(scope) {
    scope.querySelectorAll("[data-confidence-card]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const cardId = event.currentTarget.getAttribute("data-confidence-card");
        const level = Number(event.currentTarget.getAttribute("data-confidence-level") || 0);
        await store.updateCardConfidence(cardId, level);
        render();
      });
    });
  }

  function bindCardDeleteButtons(scope) {
    scope.querySelectorAll("[data-delete-card]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const cardId = event.currentTarget.getAttribute("data-delete-card");
        const card = getCardById(store.getState().cards.filter((item) => item.ownerId === getOwnerId(store.getState())), cardId);
        if (!card) {
          return;
        }
        if (!confirm(`Delete "${card.expression}"?`)) {
          return;
        }
        await store.deleteCard(cardId);
        showFlash("Card deleted.");
      });
    });
  }

  authReady = true;
  router.start();
}

function visibleLanguagePairs(state, ownerId) {
  return state.languagePairs.filter((pair) => pair.ownerId === ownerId);
}

function visibleCards(state, ownerId) {
  return state.cards
    .filter((card) => card.ownerId === ownerId)
    .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
}

function getOwnerId(state) {
  return state.settings.currentUser?.id || GUEST_OWNER_ID;
}

function getCurrentPair(languagePairs, activePairId) {
  return languagePairs.find((pair) => pair.id === activePairId) || languagePairs[0] || null;
}

function authBadge(user) {
  return `
    <div class="auth-badge">
      ${user.picture ? `<img src="${esc(user.picture)}" alt="${esc(user.name)}" />` : ""}
      <div>
        <strong>${esc(user.name || "Google User")}</strong>
        <p>${esc(user.email || "")}</p>
      </div>
    </div>
  `;
}

function pageTitle(route) {
  return {
    home: "Home",
    cards: "Cards",
    "card-new": "New Card",
    "card-detail": "Card Details",
    "card-edit": "Edit Card",
    study: "Study Mode",
    settings: "Settings",
  }[route.name] || "Phrase Forge";
}

function nav(href, label, active) {
  return `<a class="nav-link ${active ? "★" : "☆"}" href="${href}" data-route>${label}</a>`;
}

function metricCard(label, value, copy) {
  return `
    <article class="metric-card">
      <span class="summary-label">${esc(label)}</span>
      <strong>${esc(value)}</strong>
    </article>
  `;
}

function homeCardRow(card) {
  return `
    <article class="person-row">
      <div>
        <strong>${esc(card.expression)}</strong>
        <p>${esc(card.translation || card.meaning || "No translation")}</p>
      </div>
      <a class="button button-secondary" href="#/cards/${card.id}" data-route>Details</a>
    </article>
  `;
}

function cardPreview(card) {
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <p class="eyebrow">${esc(card.type === "idiom" ? "Idiom" : "Phrase")}</p>
          <h4>${esc(card.expression)}</h4>
        </div>
        <div class="star-group compact">${renderStarButtons(card.id, card.confidence)}</div>
      </div>
      ${card.type === "idiom" ? `
        <div class="preview-block">
          <span class="preview-label">Example</span>
          <div class="preview-value">${highlightExpression(card.example || "Not entered", card.expression, card.type)}</div>
        </div>
      ` : ""}
      <div class="preview-block">
        <span class="preview-label">Translation</span>
        <p class="card-copy">${esc(card.translation || card.meaning || "Not entered")}</p>
      </div>
      <div class="preview-block">
        <span class="preview-label">Nuance</span>
        <p class="card-note">${esc(card.nuance || card.notes || "Not entered")}</p>
      </div>
      <div class="card-actions">
        <a class="button button-primary" href="#/cards/${card.id}" data-route>Details</a>
        <a class="button button-secondary" href="#/cards/${card.id}/edit" data-route>Edit</a>
        <button type="button" class="button button-secondary" data-delete-card="${card.id}">Delete</button>
      </div>
    </article>
  `;
}

function definition(label, value) {
  return `<dl class="definition"><dt>${esc(label)}</dt><dd>${esc(value || "Not entered")}</dd></dl>`;
}

function richDefinition(label, html) {
  return `<dl class="definition"><dt>${esc(label)}</dt><dd>${html || "Not entered"}</dd></dl>`;
}

function input(name, label, required = false, placeholder = "", type = "text") {
  return `<label class="field"><span>${esc(label)}${required ? " *" : ""}</span><input type="${type}" name="${name}" placeholder="${esc(placeholder)}" ${required ? "required" : ""} /></label>`;
}

function textarea(name, label, placeholder = "") {
  return `<label class="field span-2" data-field="${name}"><span>${esc(label)}</span><textarea name="${name}" rows="4" placeholder="${esc(placeholder)}"></textarea></label>`;
}

function filterCards(cards, filters) {
  const query = (filters.query || "").trim().toLowerCase();
  return [...cards]
    .filter((card) => {
      const haystack = [card.expression, card.translation, card.meaning, card.example, card.exampleTranslation, card.nuance, card.notes, ...card.tags].join(" ").toLowerCase();
      return (
        (!filters.pairId || card.pairId === filters.pairId) &&
        (!query || haystack.includes(query)) &&
        (!filters.type || card.type === filters.type) &&
        (!filters.tag || card.tags.includes(filters.tag)) &&
        (
          filters.confidence === "" ||
          (filters.confidence === "0" ? Number(card.confidence || 0) === 0 : Number(card.confidence || 0) === Number(filters.confidence))
        )
      );
    })
    .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
}

function summarizeCards(cards, pairId) {
  const pairCards = cardsForPair(cards, pairId);
  const tagCounts = new Map();
  const confidence = { 0: 0, 1: 0, 2: 0, 3: 0 };
  pairCards.forEach((card) => {
    card.tags.forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
    confidence[Number(card.confidence || 0)] += 1;
  });
  return {
    total: pairCards.length,
    tagCount: tagCounts.size,
    confidence,
  };
}

function cardsForPair(cards, pairId) {
  return pairId ? cards.filter((card) => card.pairId === pairId) : cards;
}

function uniqueTags(cards) {
  return [...new Set(cards.flatMap((card) => card.tags))].sort((left, right) => left.localeCompare(right, "en"));
}

function getCardById(cards, cardId) {
  return cards.find((card) => card.id === cardId);
}

function getPairById(pairs, pairId) {
  return pairs.find((pair) => pair.id === pairId);
}

function pairLabel(pair) {
  if (!pair) {
    return "Not set";
  }
  return pair.name || `${pair.nativeLanguage} -> ${pair.targetLanguage}`;
}

function readDraftFromSession() {
  try {
    const raw = sessionStorage.getItem("phrase-forge:draft");
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Failed to read draft from sessionStorage.", error);
    return null;
  }
}

function readCardsFilterState() {
  try {
    const raw = sessionStorage.getItem("phrase-forge:cards-filters");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      query: parsed.query || "",
      type: parsed.type || "",
      tag: parsed.tag || "",
      confidence: parsed.confidence || "",
    };
  } catch (error) {
    console.error("Failed to read cards filter state.", error);
    return {
      query: "",
      type: "",
      tag: "",
      confidence: "",
    };
  }
}

function writeCardsFilterState(filters) {
  try {
    sessionStorage.setItem("phrase-forge:cards-filters", JSON.stringify(filters));
  } catch (error) {
    console.error("Failed to save cards filter state.", error);
  }
}

function readCardsFilterCollapsed() {
  return sessionStorage.getItem("phrase-forge:cards-filters-collapsed") === "true";
}

function writeCardsFilterCollapsed(collapsed) {
  sessionStorage.setItem("phrase-forge:cards-filters-collapsed", String(collapsed));
}

function createEmptyCard(pairId) {
  return {
    pairId: pairId || "",
    type: "idiom",
    expression: "",
    translation: "",
    meaning: "",
    example: "",
    exampleTranslation: "",
    nuance: "",
    notes: "",
    tags: [],
    confidence: 0,
  };
}

function fillCardForm(view, card) {
  setValue(view, "pairId", card.pairId);
  setValue(view, "type", card.type);
  setValue(view, "expression", card.expression);
  setValue(view, "translation", card.translation);
  setValue(view, "meaning", card.meaning);
  setValue(view, "example", card.example);
  setValue(view, "exampleTranslation", card.exampleTranslation);
  setValue(view, "nuance", card.nuance);
  setValue(view, "notes", card.notes);
  setValue(view, "tags", (card.tags || []).join(", "));
  setValue(view, "confidence", String(card.confidence || 0));
}

function collectCardForm(form) {
  const data = new FormData(form);
  return {
    pairId: data.get("pairId")?.toString() || "",
    type: data.get("type")?.toString() || "idiom",
    expression: data.get("expression")?.toString().trim(),
    translation: data.get("translation")?.toString().trim(),
    meaning: data.get("meaning")?.toString().trim(),
    example: data.get("example")?.toString().trim(),
    exampleTranslation: data.get("exampleTranslation")?.toString().trim(),
    nuance: data.get("nuance")?.toString().trim(),
    notes: data.get("notes")?.toString().trim(),
    tags: split(data.get("tags")),
    confidence: Number(data.get("confidence") || 0),
  };
}

function syncTypeHints(form) {
  const type = form.querySelector('[name="type"]').value;
  const idiomFields = ["meaning", "example", "exampleTranslation"];
  const phraseFields = ["translation", "notes"];

  idiomFields.forEach((name) => {
    const field = form.querySelector(`[data-field="${name}"]`);
    if (field) {
      field.classList.toggle("is-muted", type !== "idiom");
    }
  });

  phraseFields.forEach((name) => {
    const inputField = form.querySelector(`[name="${name}"]`)?.closest(".field");
    if (inputField) {
      inputField.classList.toggle("is-muted", type !== "phrase");
    }
  });
}

function renderStarButtons(cardId, value, filledOnly = false) {
  return [1, 2, 3]
    .map((level) => {
      const active = level <= Number(value || 0);
      return `<button type="button" class="star-button ${active ? "is-active" : ""} ${filledOnly ? "is-solid" : ""}" data-confidence-card="${cardId}" data-confidence-level="${level}" aria-label="Confidence ${level}">${active ? "&#9733;" : "&#9734;"}</button>`;
    })
    .join("");
}

function mergeTags(left, right) {
  return [...new Set([...(left || []), ...(right || [])])];
}

function summarizeTopTags(cards, limit) {
  const counts = new Map();
  cards.forEach((card) => {
    card.tags.forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0], "en");
    })
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

function highlightExpression(text, expression, type) {
  if (type !== "idiom" || !text || !expression) {
    return esc(text || "");
  }
  const patterns = idiomHighlightPatterns(expression);
  if (!patterns.length) {
    return esc(text || "");
  }

  const ranges = [];
  patterns.forEach((pattern) => {
    const regex = new RegExp(pattern, "gi");
    let match = regex.exec(text);
    while (match) {
      ranges.push([match.index, match.index + match[0].length]);
      if (regex.lastIndex === match.index) {
        regex.lastIndex += 1;
      }
      match = regex.exec(text);
    }
  });

  if (!ranges.length) {
    return esc(text);
  }

  const merged = mergeRanges(ranges);
  let cursor = 0;
  let output = "";
  merged.forEach(([start, end]) => {
    output += esc(text.slice(cursor, start));
    output += `<strong>${esc(text.slice(start, end))}</strong>`;
    cursor = end;
  });
  output += esc(text.slice(cursor));
  return output;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idiomHighlightPatterns(expression) {
  const normalized = expression.trim();
  if (!normalized) {
    return [];
  }
  const patterns = [];
  const words = normalized.split(/\s+/);
  const lowered = words.map((word) => word.toLowerCase());

  patterns.push(buildFlexibleIdiomPattern(words));

  if (lowered[0] === "be" && words.length > 1) {
    const tail = words.slice(1);
    patterns.push(buildFlexibleIdiomPattern(tail));
    patterns.push(`(?:['’]m|['’]re|['’]s|am|are|is|was|were|be|been|being)\\s+${buildFlexibleIdiomPattern(tail)}`);
  }

  if (words.length > 2 && isPronounLike(words[1])) {
    const verb = words[0];
    const tail = words.slice(2);
    patterns.push(`${buildVerbFamilyPattern(verb)}\\s+\\w+\\s+${buildFlexibleIdiomPattern(tail)}`);
  }

  return [...new Set(patterns)].sort((left, right) => right.length - left.length);
}

function buildFlexibleIdiomPattern(words) {
  return words
    .map((word, index) => {
      if (index === 0) {
        return buildVerbFamilyPattern(word);
      }
      return escapeRegExp(word);
    })
    .join("\\s+");
}

function buildVerbFamilyPattern(word) {
  const lowered = word.toLowerCase();
  if (lowered === "be") {
    return "(?:be|am|are|is|was|were|been|being|['’]m|['’]re|['’]s)";
  }
  if (lowered === "give") {
    return "(?:give|gives|gave|given|giving)";
  }
  return escapeRegExp(word);
}

function isPronounLike(word) {
  return /^(someone|somebody|something|anyone|anybody|me|you|him|her|us|them)$/i.test(word);
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const merged = [];
  sorted.forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (!last || start > last[1]) {
      merged.push([start, end]);
      return;
    }
    last[1] = Math.max(last[1], end);
  });
  return merged;
}

function filterStudyCards(cards, tag) {
  const items = tag ? cards.filter((card) => card.tags.includes(tag)) : cards;
  return [...items].sort((left, right) => {
    const confidenceDiff = Number(left.confidence || 0) - Number(right.confidence || 0);
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }
    return (left.updatedAt || "").localeCompare(right.updatedAt || "");
  });
}

function clampIndex(index, length) {
  if (!length) {
    return 0;
  }
  if (Number.isNaN(index) || index < 0) {
    return 0;
  }
  if (index >= length) {
    return length - 1;
  }
  return index;
}

function formatApiError(error) {
  const message = error?.message || "Failed to generate content.";
  if (message.includes("insufficient_quota") || message.includes("429")) {
    return "OpenAI API quota has been exceeded. Please check your billing or remaining balance.";
  }
  return message;
}

function decodeGoogleCredential(credential) {
  try {
    const payload = credential.split(".")[1];
    const base64 = `${payload.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (payload.length % 4)) % 4)}`;
    return JSON.parse(decodeURIComponent(atob(base64).split("").map((char) => `%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`).join("")));
  } catch (error) {
    console.error("Failed to decode Google credential.", error);
    return null;
  }
}

function setValue(scope, name, value) {
  const field = scope.querySelector(`[name="${name}"]`);
  if (field) {
    field.value = value || "";
  }
}

function split(value) {
  const rawItems = Array.isArray(value) ? value : (value?.toString() || "").split(/[,\n、]/);
  return rawItems
    .map((item) => item?.toString().trim())
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
