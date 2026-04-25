import { createRouter } from "./router.js";
import { createStore } from "./state/store.js";
import { createFlashcardGenerationService } from "./services/flashcardGenerationService.js";
import { createStorage } from "./services/storage.js";
import { loadAppConfig } from "./services/appConfigService.js";
import { createCloudService } from "./services/cloudService.js";
import { loadOpenAiModels } from "./services/openAiModelsService.js";
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
  const availableOpenAiModels = await loadOpenAiModels(appConfig.openAiModel);
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
    renderView(route, state, { ownerId, user, languagePairs, currentPair, cards, cardsForCurrentPair, state, availableOpenAiModels });
    bindGlobalUi();
  }

  function layout(route, user, languagePairs, currentPair, cards) {
    const stats = summarizeCards(cards, currentPair?.id);

    return `
      <div class="app-shell">
        <header class="app-header">
          <div class="header-main">
            <div class="header-actions">
              ${iconLink({ href: "#/home", label: "Home", icon: "home", active: route.name === "home", className: "button button-secondary icon-button nav-icon-button" })}
              ${iconLink({ href: "#/cards", label: "Cards", icon: "cards", active: ["cards", "card-new", "card-detail", "card-edit"].includes(route.name), className: "button button-secondary icon-button nav-icon-button" })}
              ${iconLink({ href: "#/study", label: "Study Mode", icon: "study", active: route.name === "study", className: "button button-secondary icon-button nav-icon-button" })}
              ${iconLink({ href: "#/settings", label: "Settings", icon: "settings", active: route.name === "settings", className: "button button-secondary icon-button nav-icon-button" })}
              ${iconLink({ href: "#/cards/new", label: "Add Card", icon: "add", className: "button button-primary icon-button nav-icon-button" })}
              ${cloud.enabled
                ? user
                  ? profileButton(user)
                  : iconButton({ id: "sign-in-button", label: "Sign in with Google", icon: "login", className: "button button-secondary icon-button header-icon-button auth-button" })
                : '<span class="header-note">Local mode</span>'}
            </div>
          </div>
        </header>

        <main class="content">
          ${renderPageHead(route, stats)}

          <div id="flash-region">${flashMessage ? `<div class="flash-message">${esc(flashMessage)}</div>` : ""}</div>
          <section id="view"></section>
          ${renderPageFooter(route)}
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
    const homeState = readHomeViewState();
    const pageSize = Math.max(1, Number(context.state.settings.homeExamplesPerPage || 8));
    const items = filterCards(context.cards, {
      query: "",
      type: "",
      tag: homeState.tag,
      confidence: "",
      pairId: context.currentPair?.id || "",
    });
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const currentPage = Math.min(homeState.page, totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const visibleItems = items.slice(startIndex, startIndex + pageSize);
    const allRankedTags = summarizeTopTags(context.cardsForCurrentPair, Number(context.cardsForCurrentPair.length || 999));
    const tagLimit = context.state?.settings?.homeTagLimit || 5;
    const topTags = allRankedTags.slice(0, tagLimit);
    const hiddenTags = allRankedTags.slice(tagLimit);

    view.innerHTML = `
      <section class="stack">
        ${topTags.length ? `
          <section class="panel">
            <div class="tag-shortcuts">
              ${topTags.map((item) => `
                <button type="button" class="tag-shortcut-button ${homeState.tag === item.tag ? "is-active" : ""}" data-home-tag="${esc(item.tag)}">
                  ${esc(item.tag)}
                </button>
              `).join("")}
              ${hiddenTags.length ? `
                <button type="button" class="tag-shortcut-button ${homeState.showAllTags ? "is-active" : ""}" id="toggle-home-tags">
                  Others
                </button>
              ` : ""}
              ${homeState.tag ? `<button type="button" class="tag-shortcut-button" data-home-clear="true">All</button>` : ""}
            </div>
            ${hiddenTags.length && homeState.showAllTags ? `
              <div class="tag-shortcuts tag-shortcuts-extra">
                ${hiddenTags.map((item) => `
                  <button type="button" class="tag-shortcut-button ${homeState.tag === item.tag ? "is-active" : ""}" data-home-tag="${esc(item.tag)}">
                    ${esc(item.tag)}
                  </button>
                `).join("")}
              </div>
            ` : ""}
          </section>
        ` : ""}

        <section class="panel">
          <div class="list-stack">
            ${visibleItems.length ? visibleItems.map(homeCardRow).join("") : `<div class="empty-state">No examples match the current tag yet.</div>`}
          </div>
          ${items.length > pageSize ? `
            <div class="pagination-bar">
              ${iconButton({ id: "home-prev-page", label: "Previous page", icon: "prev", className: "button button-secondary icon-button" })}
              <span class="pagination-status">${currentPage} / ${totalPages}</span>
              ${iconButton({ id: "home-next-page", label: "Next page", icon: "next", className: "button button-secondary icon-button" })}
            </div>
          ` : ""}
        </section>
      </section>
    `;

    view.querySelectorAll("[data-home-tag]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const nextTag = event.currentTarget.getAttribute("data-home-tag") || "";
        writeHomeViewState({
          tag: homeState.tag === nextTag ? "" : nextTag,
          page: 1,
          showAllTags: homeState.showAllTags,
        });
        render();
      });
    });

    bindConfidenceButtons(view);

    const toggleTagsButton = view.querySelector("#toggle-home-tags");
    if (toggleTagsButton) {
      toggleTagsButton.addEventListener("click", () => {
        writeHomeViewState({
          tag: homeState.tag,
          page: homeState.page,
          showAllTags: !homeState.showAllTags,
        });
        render();
      });
    }

    const clearButton = view.querySelector("[data-home-clear]");
    if (clearButton) {
      clearButton.addEventListener("click", () => {
        writeHomeViewState({ tag: "", page: 1, showAllTags: homeState.showAllTags });
        render();
      });
    }

    const prevButton = view.querySelector("#home-prev-page");
    const nextButton = view.querySelector("#home-next-page");
    if (prevButton) {
      prevButton.disabled = currentPage <= 1;
      prevButton.addEventListener("click", () => {
        writeHomeViewState({ tag: homeState.tag, page: Math.max(1, currentPage - 1), showAllTags: homeState.showAllTags });
        render();
      });
    }
    if (nextButton) {
      nextButton.disabled = currentPage >= totalPages;
      nextButton.addEventListener("click", () => {
        writeHomeViewState({ tag: homeState.tag, page: Math.min(totalPages, currentPage + 1), showAllTags: homeState.showAllTags });
        render();
      });
    }
  }

  function renderCards(view, context) {
    const savedFilters = readCardsFilterState();
    const filtersCollapsed = readCardsFilterCollapsed();
    const pageSize = Math.max(1, Number(context.state.settings.cardsPerPage || 12));
    let currentPage = clampPageNumber(Number(sessionStorage.getItem("phrase-forge:cards-page") || 1));
    view.innerHTML = `
      <section class="panel">
        <div class="section-head">
          <div></div>
          <div class="card-actions">
            ${iconButton({ id: "toggle-filters", label: filtersCollapsed ? "Show filters" : "Hide filters", icon: "filter", className: `button button-secondary icon-button ${filtersCollapsed ? "" : "is-active"}` })}
            <button type="button" class="button button-secondary type-chip ${savedFilters.type === "idiom" ? "is-active" : ""}" id="type-idiom">Idiom</button>
            <button type="button" class="button button-secondary type-chip ${savedFilters.type === "phrase" ? "is-active" : ""}" id="type-phrase">Phrase</button>
          </div>
        </div>
        <div class="toolbar toolbar-4 ${filtersCollapsed ? "is-collapsed" : ""}" id="cards-toolbar">
          <label class="field"><span>Search</span><input id="search" type="search" placeholder="Search expressions, examples, translations, or nuance" /></label>
          <label class="field"><span>Tags</span><select id="tag-filter"><option value="">All</option>${uniqueTags(context.cardsForCurrentPair).map((tag) => `<option value="${esc(tag)}">${esc(tag)}</option>`).join("")}</select></label>
          <label class="field"><span>Confidence</span><select id="confidence-filter">${CONFIDENCE_LEVELS.map((level) => `<option value="${level.value}">${level.label}</option>`).join("")}</select></label>
        </div>
        <div id="card-list" class="card-grid"></div>
        <div id="card-pagination"></div>
      </section>
    `;

    const search = view.querySelector("#search");
    const tag = view.querySelector("#tag-filter");
    const confidence = view.querySelector("#confidence-filter");
    const toggleFilters = view.querySelector("#toggle-filters");
    const idiomButton = view.querySelector("#type-idiom");
    const phraseButton = view.querySelector("#type-phrase");
    const toolbar = view.querySelector("#cards-toolbar");
    const pagination = view.querySelector("#card-pagination");

    search.value = savedFilters.query;
    tag.value = savedFilters.tag;
    confidence.value = savedFilters.confidence;

    toggleFilters.addEventListener("click", () => {
      const collapsed = toolbar.classList.toggle("is-collapsed");
      writeCardsFilterCollapsed(collapsed);
      toggleFilters.classList.toggle("is-active", !collapsed);
      toggleFilters.setAttribute("aria-label", collapsed ? "Show filters" : "Hide filters");
      toggleFilters.setAttribute("title", collapsed ? "Show filters" : "Hide filters");
    });

    const update = () => {
      writeCardsFilterState({
        query: search.value,
        type: savedFilters.type,
        tag: tag.value,
        confidence: confidence.value,
      });
      const items = filterCards(context.cards, {
        query: search.value,
        type: savedFilters.type,
        tag: tag.value,
        confidence: confidence.value,
        pairId: context.currentPair?.id || "",
      });
      const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
      currentPage = Math.min(currentPage, totalPages);
      const startIndex = (currentPage - 1) * pageSize;
      const visibleItems = items.slice(startIndex, startIndex + pageSize);

      view.querySelector("#card-list").innerHTML = items.length
        ? visibleItems.map(cardPreview).join("")
        : `<div class="empty-state">No cards match the current filters. Try broadening your search.</div>`;
      pagination.innerHTML = items.length > pageSize
        ? `
            <div class="pagination-bar">
              ${iconButton({ id: "cards-prev-page", label: "Previous page", icon: "prev", className: "button button-secondary icon-button" })}
              <span class="pagination-status">${currentPage} / ${totalPages}</span>
              ${iconButton({ id: "cards-next-page", label: "Next page", icon: "next", className: "button button-secondary icon-button" })}
            </div>
          `
        : "";
      sessionStorage.setItem("phrase-forge:cards-page", String(currentPage));
      bindRoutes();
      bindConfidenceButtons(view);
      bindCardDeleteButtons(view);
      bindPagination(totalPages);
    };

    const resetPageAndUpdate = () => {
      currentPage = 1;
      sessionStorage.setItem("phrase-forge:cards-page", "1");
      update();
    };

    const selectType = (nextType) => {
      savedFilters.type = nextType;
      idiomButton.classList.toggle("is-active", nextType === "idiom");
      phraseButton.classList.toggle("is-active", nextType === "phrase");
      resetPageAndUpdate();
    };

    function bindPagination(totalPages) {
      const prevButton = view.querySelector("#cards-prev-page");
      const nextButton = view.querySelector("#cards-next-page");
      if (prevButton) {
        prevButton.disabled = currentPage <= 1;
        prevButton.addEventListener("click", () => {
          currentPage = Math.max(1, currentPage - 1);
          update();
        });
      }
      if (nextButton) {
        nextButton.disabled = currentPage >= totalPages;
        nextButton.addEventListener("click", () => {
          currentPage = Math.min(totalPages, currentPage + 1);
          update();
        });
      }
    }

    search.addEventListener("input", resetPageAndUpdate);
    tag.addEventListener("change", resetPageAndUpdate);
    confidence.addEventListener("change", resetPageAndUpdate);
    idiomButton.addEventListener("click", () => selectType("idiom"));
    phraseButton.addEventListener("click", () => selectType("phrase"));
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
            ${iconButton({ id: "generate-button-top", label: "Generate draft", icon: "sparkles", className: "button button-secondary icon-button" })}
            ${iconButton({ type: "submit", form: "card-form", label: "Save card", icon: "save", className: "button button-primary icon-button" })}
          </div>
        </div>
        <form id="card-form" class="form-grid">
          <input type="hidden" name="exampleHighlightRanges" value="[]" />
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
          ${editingCard ? `
            <label class="field">
              <span>Confidence</span>
              <select name="confidence">
                <option value="0">Unrated</option>
                <option value="1">Star 1</option>
                <option value="2">Star 2</option>
                <option value="3">Star 3</option>
              </select>
            </label>
          ` : ""}
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

    const cardForm = view.querySelector("#card-form");
    syncTypeHints(cardForm);
    cardForm.querySelector('[name="type"]').addEventListener("change", (event) => {
      syncTypeHints(event.currentTarget.form);
    });
    bindExampleHighlightField(cardForm);

    cardForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const card = collectCardForm(event.currentTarget);
      const exampleChanged = !!editingCard && card.example !== editingCard.example;
      if (editingCard && !exampleChanged) {
        card.exampleHighlightRanges = editingCard.exampleHighlightRanges || [];
      }
      if (exampleChanged) {
        card.exampleHighlightRanges = [];
      }
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
      const form = cardForm;
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
      button.innerHTML = iconMarkup("spinner");
      button.setAttribute("aria-label", "Generating draft");
      button.setAttribute("title", "Generating draft");

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
        button.innerHTML = iconMarkup("sparkles");
        button.setAttribute("aria-label", "Generate draft");
        button.setAttribute("title", "Generate draft");
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
            ${iconLink({ href: "#/cards", label: "Back to list", icon: "back", className: "button button-secondary icon-button" })}
            ${iconLink({ href: `#/cards/${card.id}/edit`, label: "Edit card", icon: "edit", className: "button button-primary icon-button" })}
            ${iconButton({ id: "delete-card-button", label: "Delete card", icon: "trash", className: "button button-secondary icon-button" })}
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
            ${richDefinition("Example", renderHighlightedExample(card))}
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
            ${iconButton({ type: "submit", label: "Update filters", icon: "filter", className: "button button-secondary icon-button" })}
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
            <div class="study-example">${renderHighlightedExample(card, card.example || card.expression)}</div>
          </div>
          <div class="study-back ${revealed ? "is-visible" : ""}">
            <dl class="study-definition">
              <dt>Translation</dt>
              <dd>${esc(card.translation || card.meaning || "Not entered")}</dd>
              <dt>Example Translation</dt>
              <dd>${esc(card.exampleTranslation || "Not entered")}</dd>
              <dt>Nuance</dt>
              <dd>${esc(card.nuance || card.notes || "Not entered")}</dd>
            </dl>
          </div>
          <div class="study-actions">
            ${iconButton({ id: "prev-card", label: "Previous card", icon: "prev", className: "button button-secondary icon-button" })}
            <div class="confidence-row">
              <div class="star-group">${renderStarButtons(card.id, card.confidence, true)}</div>
            </div>
            ${iconButton({ id: "next-card", label: "Next card", icon: "next", className: "button button-primary icon-button" })}
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
            <label class="field">
              <span>OpenAI Model *</span>
              <select name="openAiModel" required>
                ${availableModelOptions(context.availableOpenAiModels, state.settings.openAiModel).map((model) => `<option value="${esc(model)}">${esc(model)}</option>`).join("")}
              </select>
            </label>
            ${input("homeTagLimit", "Home Tags Limit", true, "e.g. 5", "number")}
            ${input("homeExamplesPerPage", "Home Examples Per Page", true, "e.g. 8", "number")}
            ${input("cardsPerPage", "Cards Per Page", true, "e.g. 12", "number")}
            <div class="form-actions">
              ${iconButton({ type: "submit", label: "Save settings", icon: "save", className: "button button-primary icon-button" })}
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
                  ${iconButton({ label: "Switch language pair", icon: "switch", className: "button button-secondary icon-button", attributes: `data-activate-pair="${pair.id}"` })}
                  ${iconButton({ label: "Edit language pair", icon: "edit", className: "button button-secondary icon-button", attributes: `data-edit-pair="${pair.id}"` })}
                  ${iconButton({ label: "Delete language pair", icon: "trash", className: "button button-secondary icon-button", attributes: `data-delete-pair="${pair.id}"` })}
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
              ${iconButton({ type: "submit", label: editingPair ? "Update language pair" : "Add language pair", icon: editingPair ? "save" : "add", className: "button button-secondary icon-button" })}
              ${editingPair ? iconButton({ id: "cancel-pair-edit", label: "Cancel edit", icon: "close", className: "button button-secondary icon-button" }) : ""}
            </div>
          </form>
        </section>
      </section>
    `;

    setValue(view, "openAiModel", state.settings.openAiModel);
    setValue(view, "homeTagLimit", String(state.settings.homeTagLimit || 5));
    setValue(view, "homeExamplesPerPage", String(state.settings.homeExamplesPerPage || 8));
    setValue(view, "cardsPerPage", String(state.settings.cardsPerPage || 12));
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
        homeExamplesPerPage: data.get("homeExamplesPerPage")?.toString().trim(),
        cardsPerPage: data.get("cardsPerPage")?.toString().trim(),
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

function renderPageHead(route, stats) {
  const meta = showPageStats(route.name)
    ? `
        <div class="page-head-stats">
          ${pageStat("Cards", stats.total)}
          ${pageStarStat(1, stats.confidence[1])}
          ${pageStarStat(2, stats.confidence[2])}
          ${pageStarStat(3, stats.confidence[3])}
        </div>
      `
    : "";

  return `
    <section class="page-head">
      <h1>${esc(pageTitle(route))}</h1>
      ${meta}
    </section>
  `;
}

function showPageStats(routeName) {
  return routeName === "cards" || routeName === "study";
}

function pageStat(label, value) {
  return `<span class="page-stat"><span class="page-stat-label">${esc(label)}</span><strong>${esc(value)}</strong></span>`;
}

function availableModelOptions(models, selectedModel) {
  return [...new Set([selectedModel, ...(models || [])].filter((item) => item?.toString().trim()))];
}

function pageStarStat(level, value) {
  return `<span class="page-stat page-stat-stars"><span class="page-stat-symbol">${"★".repeat(level)}</span><strong>${esc(value)}</strong></span>`;
}

function renderPageFooter(route) {
  if (route.name === "home") {
    return "";
  }
  return `
    <footer class="page-footer">
      <a class="page-footer-brand" href="#/home" data-route>Phrase Forge</a>
    </footer>
  `;
}

function homeCardRow(card) {
  const example = card.example || card.expression || "No example";
  const exampleTranslation = card.exampleTranslation || card.translation || card.meaning || "No translation";
  return `
    <article class="person-row">
      <div>
        <span class="preview-label">${esc(card.expression)}</span>
        <div class="home-example-text">${renderHighlightedExample(card, example)}</div>
        <p>${esc(exampleTranslation)}</p>
      </div>
      <div class="row-actions">
        <div class="star-group compact">${renderStarButtons(card.id, card.confidence, true)}</div>
        ${iconLink({ href: `#/cards/${card.id}`, label: "View card details", icon: "open", className: "button button-secondary icon-button" })}
      </div>
    </article>
  `;
}

function cardPreview(card) {
  return `
    <article class="card">
      <div class="card-head">
        <div class="star-group compact">${renderStarButtons(card.id, card.confidence)}</div>
        <div class="card-title-block">
          <p class="eyebrow">${esc(card.type === "idiom" ? "Idiom" : "Phrase")}</p>
          <h4>${esc(card.expression)}</h4>
        </div>
      </div>
      ${card.type === "idiom" ? `
        <div class="preview-block">
          <span class="preview-label">Example</span>
          <div class="preview-value">${renderHighlightedExample(card, card.example || "Not entered")}</div>
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
        ${iconLink({ href: `#/cards/${card.id}`, label: "View card details", icon: "open", className: "button button-primary icon-button" })}
        ${iconLink({ href: `#/cards/${card.id}/edit`, label: "Edit card", icon: "edit", className: "button button-secondary icon-button" })}
        ${iconButton({ label: "Delete card", icon: "trash", className: "button button-secondary icon-button", attributes: `data-delete-card="${card.id}"` })}
      </div>
    </article>
  `;
}

function iconLink({ href, label, icon, className = "", active = false }) {
  const classes = [className, active ? "is-active" : ""].filter(Boolean).join(" ");
  return `<a class="${classes}" href="${href}" data-route aria-label="${esc(label)}" title="${esc(label)}">${iconMarkup(icon)}</a>`;
}

function iconButton({ id = "", type = "button", form = "", label, icon, className = "", attributes = "" }) {
  const idAttribute = id ? ` id="${id}"` : "";
  const formAttribute = form ? ` form="${form}"` : "";
  const extraAttributes = attributes ? ` ${attributes}` : "";
  return `<button${idAttribute} type="${type}" class="${className}" aria-label="${esc(label)}" title="${esc(label)}"${formAttribute}${extraAttributes}>${iconMarkup(icon)}</button>`;
}

function profileButton(user) {
  const content = user?.picture
    ? `<img class="profile-button-image" src="${esc(user.picture)}" alt="" />`
    : iconMarkup("logout");
  return `<button id="sign-out-button" type="button" class="button button-secondary icon-button header-icon-button profile-button" aria-label="Sign out" title="Sign out">${content}</button>`;
}

function iconMarkup(icon) {
  return `<span class="button-icon" aria-hidden="true">${iconSvg(icon)}</span>`;
}

function iconSvg(icon) {
  const icons = {
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="13" height="10" rx="2"/><path d="M8 4h10a2 2 0 0 1 2 2v10"/><path d="M7 10h7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.5-1 9-9a2.1 2.1 0 0 0-3-3l-9 9L4 20z"/><path d="M13.5 6.5l3 3"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16"/><path d="M7 12h10"/><path d="M10 17h4"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5L12 5l8 6.5"/><path d="M7 10.5V19h10v-8.5"/></svg>',
    login: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16l4-4-4-4"/><path d="M8 12h10"/><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/><path d="M14 8l4 4-4 4"/><path d="M8 12h10"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 7H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3"/><path d="M13 5h6v6"/><path d="M19 5l-9 9"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h9.9L19 7.6V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18z"/><path d="M8 5v5h8V7"/><path d="M9 19v-5h6v5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z"/><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1.2 1.2a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2a1 1 0 0 0-.6.9V20a1 1 0 0 1-1 1h-1.8a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9a1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0L4.3 17.9a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1a1 1 0 0 0-.9-.6H3.5a1 1 0 0 1-1-1v-1.8a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6a1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4l1.2-1.2a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2a1 1 0 0 0 .6-.9V4a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9a1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1.2 1.2a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1a1 1 0 0 0 .9.6h.2a1 1 0 0 1 1 1v1.8a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6z"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 4v3"/><path d="M20.5 5.5h-3"/><path d="M5 16v5"/><path d="M7.5 18.5h-5"/></svg>',
    spinner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 4a8 8 0 1 1-8 8"/></svg>',
    study: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21z"/><path d="M5 5.5V21"/><path d="M9 7h6"/><path d="M9 11h6"/></svg>',
    switch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h11"/><path d="M15 4l3 3-3 3"/><path d="M17 17H6"/><path d="M9 20l-3-3 3-3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 12h8l1-12"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>',
  };
  return icons[icon] || icons.settings;
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
      type: parsed.type === "phrase" ? "phrase" : "idiom",
      tag: parsed.tag || "",
      confidence: parsed.confidence || "",
    };
  } catch (error) {
    console.error("Failed to read cards filter state.", error);
    return {
      query: "",
      type: "idiom",
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

function readHomeViewState() {
  try {
    const raw = sessionStorage.getItem("phrase-forge:home-view");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      tag: parsed.tag || "",
      page: clampPageNumber(Number(parsed.page || 1)),
      showAllTags: parsed.showAllTags === true,
    };
  } catch (error) {
    console.error("Failed to read home view state.", error);
    return {
      tag: "",
      page: 1,
      showAllTags: false,
    };
  }
}

function writeHomeViewState(viewState) {
  try {
    sessionStorage.setItem("phrase-forge:home-view", JSON.stringify({
      tag: viewState.tag || "",
      page: clampPageNumber(Number(viewState.page || 1)),
      showAllTags: viewState.showAllTags === true,
    }));
  } catch (error) {
    console.error("Failed to save home view state.", error);
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
    exampleHighlightRanges: [],
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
  setValue(view, "exampleHighlightRanges", JSON.stringify(normalizeStoredHighlightRanges(card.exampleHighlightRanges, card.example)));
  setValue(view, "nuance", card.nuance);
  setValue(view, "notes", card.notes);
  setValue(view, "tags", (card.tags || []).join(", "));
  setValue(view, "confidence", String(card.confidence || 0));
}

function collectCardForm(form) {
  const data = new FormData(form);
  const example = data.get("example")?.toString().trim() || "";
  return {
    pairId: data.get("pairId")?.toString() || "",
    type: data.get("type")?.toString() || "idiom",
    expression: data.get("expression")?.toString().trim(),
    translation: data.get("translation")?.toString().trim(),
    meaning: data.get("meaning")?.toString().trim(),
    example,
    exampleTranslation: data.get("exampleTranslation")?.toString().trim(),
    exampleHighlightRanges: normalizeStoredHighlightRanges(readHighlightRangesField(data.get("exampleHighlightRanges")), example),
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

function bindExampleHighlightField(form) {
  const exampleField = form.querySelector('[name="example"]');
  const rangesField = form.querySelector('[name="exampleHighlightRanges"]');
  if (!exampleField || !rangesField) {
    return;
  }
  exampleField.addEventListener("input", () => {
    rangesField.value = "[]";
  });
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

function renderHighlightedExample(card, textOverride = null) {
  const text = textOverride ?? card.example ?? "";
  const ranges = normalizeStoredHighlightRanges(card.exampleHighlightRanges, text);
  if (ranges.length) {
    return highlightTextWithRanges(text, ranges);
  }
  return highlightExpression(text, card.expression, card.type);
}

function highlightTextWithRanges(text, ranges) {
  if (!text) {
    return "";
  }
  const merged = mergeRanges(ranges.map((range) => [range.start, range.end]));
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

function readHighlightRangesField(value) {
  try {
    const parsed = JSON.parse(value?.toString() || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to parse example highlight ranges.", error);
    return [];
  }
}

function normalizeStoredHighlightRanges(ranges, text) {
  const maxLength = (text || "").length;
  const rawItems = Array.isArray(ranges) ? ranges : [];
  return rawItems
    .map((range) => ({
      start: Number(range?.start),
      end: Number(range?.end),
    }))
    .filter((range) => Number.isInteger(range.start) && Number.isInteger(range.end))
    .filter((range) => range.start >= 0 && range.end > range.start && range.end <= maxLength)
    .sort((left, right) => left.start - right.start);
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
  const words = normalized.split(/\s+/).map(normalizeIdiomToken).filter(Boolean);
  const lowered = words.map((word) => word.toLowerCase());

  patterns.push(buildFlexibleIdiomPattern(words));

  if (isModalAuxiliary(lowered[0]) && words.length > 1) {
    patterns.push(buildFlexibleIdiomPattern(words.slice(1)));
  }

  if (lowered[0] === "be" && words.length > 1) {
    const tail = words.slice(1);
    patterns.push(buildFlexibleIdiomPattern(tail));
    patterns.push(`(?:['’]m|['’]re|['’]s|am|are|is|was|were|be|been|being)\\s+${buildFlexibleIdiomPattern(tail)}`);
  }

  if (words.length > 2 && isPronounLike(words[1])) {
    const verb = words[0];
    const tail = words.slice(2);
    patterns.push(`${buildExpandedVerbFamilyPattern(verb)}\\s+\\w+\\s+${buildFlexibleIdiomPattern(tail)}`);
  }

  return [...new Set(patterns)].sort((left, right) => right.length - left.length);
}

function buildFlexibleIdiomPattern(words) {
  return words
    .map((word, index) => {
      if (index === 0) {
        return buildExpandedVerbFamilyPattern(word);
      }
      return buildIdiomWordPattern(word);
    })
    .join("\\s+");
}

function buildExpandedVerbFamilyPattern(word) {
  const lowered = word.toLowerCase();
  const irregularFamilies = {
    be: "(?:be|am|are|is|was|were|been|being|['â€™]m|['â€™]re|['â€™]s)",
    come: "(?:come|comes|came|coming)",
    cut: "(?:cut|cuts|cutting)",
    drive: "(?:drive|drives|drove|driven|driving)",
    feel: "(?:feel|feels|felt|feeling)",
    give: "(?:give|gives|gave|given|giving)",
    let: "(?:let|lets|letting)",
    pick: "(?:pick|picks|picked|picking)",
    stick: "(?:stick|sticks|stuck|sticking)",
  };
  if (irregularFamilies[lowered]) {
    return irregularFamilies[lowered];
  }
  if (lowered.endsWith("e")) {
    return `(?:${escapeRegExp(word)}|${escapeRegExp(`${word}s`)}|${escapeRegExp(`${word}d`)}|${escapeRegExp(`${word.slice(0, -1)}ing`)})`;
  }
  return `(?:${escapeRegExp(word)}|${escapeRegExp(`${word}s`)}|${escapeRegExp(`${word}ed`)}|${escapeRegExp(`${word}ing`)})`;
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

function buildIdiomWordPattern(word) {
  const lowered = word.toLowerCase();
  if (lowered === "sb" || lowered === "somebody" || lowered === "someone") {
    return "(?:someone|somebody|anyone|anybody|me|you|him|her|us|them|\\w+)";
  }
  if (lowered === "sth" || lowered === "something") {
    return "(?:something|anything|it|this|that|\\w+)";
  }
  if (lowered === "one's") {
    return "(?:my|your|his|her|our|their|one['’]s)";
  }
  if (lowered === "oneself") {
    return "(?:myself|yourself|himself|herself|ourselves|themselves|oneself)";
  }
  return escapeRegExp(word);
}

function normalizeIdiomToken(word) {
  return word.replace(/^[^\w]+|[^\w'.’]+$/g, "");
}

function isPronounLike(word) {
  return /^(someone|somebody|something|anyone|anybody|me|you|him|her|us|them|sb|sth|one's|oneself)$/i.test(word);
}

function isModalAuxiliary(word) {
  return /^(can|could|may|might|must|shall|should|will|would)$/i.test(word);
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

function clampPageNumber(page) {
  if (Number.isNaN(page) || page < 1) {
    return 1;
  }
  return Math.round(page);
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
