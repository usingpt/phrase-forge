import { createRouter } from "./router.js";
import { createStore } from "./state/store.js";
import { createFlashcardGenerationService } from "./services/flashcardGenerationService.js";
import { formatDateTime } from "./utils/formatters.js";

const CARD_TYPES = [
  { value: "idiom", label: "イディオム" },
  { value: "phrase", label: "フレーズ" },
];

const CONFIDENCE_LEVELS = [
  { value: "", label: "すべて" },
  { value: "0", label: "未設定" },
  { value: "1", label: "星1" },
  { value: "2", label: "星2" },
  { value: "3", label: "星3" },
];

const GUEST_OWNER_ID = "guest-local";

export function createApp(rootElement) {
  const store = createStore();
  const generator = createFlashcardGenerationService();
  const router = createRouter({ onRouteChange: render });
  let flashMessage = "";

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
    bindGlobalUi(state);
    renderGoogleButtonIfNeeded(state);
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
              <span class="header-stat"><span class="header-stat-label">ユーザー</span><strong>${esc(user?.name || "ゲスト")}</strong></span>
              <span class="header-stat"><span class="header-stat-label">カード</span><strong>${stats.total}</strong></span>
              <span class="header-stat"><span class="header-stat-label">星1-2</span><strong>${stats.confidence[1] + stats.confidence[2]}</strong></span>
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
                ${user ? authBadge(user) : `<div id="google-signin-button"></div>`}
              </div>
              <button type="button" class="menu-button" id="menu-toggle" aria-expanded="false" aria-controls="header-menu">
                <span></span><span></span><span></span>
              </button>
            </div>
          </div>
          <nav class="header-menu" id="header-menu" hidden>
            ${nav("#/home", "ホーム", route.name === "home")}
            ${nav("#/cards", "カード一覧", ["cards", "card-new", "card-detail", "card-edit"].includes(route.name))}
            ${nav("#/study", "学習モード", route.name === "study")}
            ${nav("#/settings", "設定", route.name === "settings")}
            <a class="nav-link buttonlike" href="#/cards/new" data-route>カードを追加</a>
            ${user ? `<button type="button" class="nav-link nav-button" id="sign-out-button">Googleからログアウト</button>` : ""}
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

  function bindGlobalUi(state) {
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
      pairSwitcher.addEventListener("change", (event) => {
        store.updateActivePair(event.currentTarget.value);
        render();
      });
    }

    const signOutButton = rootElement.querySelector("#sign-out-button");
    if (signOutButton) {
      signOutButton.addEventListener("click", () => {
        if (window.google?.accounts?.id) {
          window.google.accounts.id.disableAutoSelect();
        }
        store.updateCurrentUser(null);
        showFlash("ゲストモードに切り替えました。");
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

  function renderGoogleButtonIfNeeded(state) {
    const buttonHost = rootElement.querySelector("#google-signin-button");
    if (!buttonHost || !state.settings.googleClientId || !window.google?.accounts?.id) {
      return;
    }

    buttonHost.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: state.settings.googleClientId,
      callback: (response) => {
        const profile = decodeGoogleCredential(response.credential);
        if (!profile?.sub) {
          alert("Google認証の結果を読み取れませんでした。");
          return;
        }
        store.updateCurrentUser({
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          picture: profile.picture,
        });
        showFlash("Googleアカウントでログインしました。");
      },
    });
    window.google.accounts.id.renderButton(buttonHost, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
      width: 220,
    });
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
            <a class="button button-primary" href="#/cards/new" data-route>カード追加</a>
            <a class="button button-secondary" href="#/cards" data-route>カード一覧</a>
            <a class="button button-secondary" href="#/study" data-route>学習モード</a>
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
            ${latestCards.length ? latestCards.map(homeCardRow).join("") : `<div class="empty-state">まだカードがありません。メニューからカードを追加してください。</div>`}
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
            <a class="button button-primary" href="#/cards/new" data-route>カード追加</a>
            <button type="button" class="button button-secondary" id="toggle-filters">${filtersCollapsed ? "検索条件を表示" : "検索条件を隠す"}</button>
          </div>
        </div>
        <div class="toolbar toolbar-4 ${filtersCollapsed ? "is-collapsed" : ""}" id="cards-toolbar">
          <label class="field"><span>検索</span><input id="search" type="search" placeholder="表現、例文、訳、ニュアンスで検索" /></label>
          <label class="field"><span>種別</span><select id="type-filter"><option value="">すべて</option>${CARD_TYPES.map((type) => `<option value="${type.value}">${type.label}</option>`).join("")}</select></label>
          <label class="field"><span>タグ</span><select id="tag-filter"><option value="">すべて</option>${uniqueTags(context.cardsForCurrentPair).map((tag) => `<option value="${esc(tag)}">${esc(tag)}</option>`).join("")}</select></label>
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
      toggleFilters.textContent = collapsed ? "検索条件を表示" : "検索条件を隠す";
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
        : `<div class="empty-state">条件に合うカードが見つかりません。検索条件を少し広げると見つかりやすいです。</div>`;
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
      navigateWithFlash("#/cards", "カードが見つからなかったため一覧へ戻しました。");
      return;
    }

    const draft = !editingCard ? readDraftFromSession() : null;
    const initialType = editingCard?.type || draft?.type || "idiom";

    view.innerHTML = `
      <section class="panel">
        <div class="section-head">
          <div></div>
          <div class="card-actions">
            <button type="button" id="generate-button-top" class="button button-secondary">生成</button>
            <button type="submit" form="card-form" class="button button-primary">保存</button>
          </div>
        </div>
        <form id="card-form" class="form-grid">
          <label class="field">
            <span>言語ペア *</span>
            <select name="pairId" required>
              ${context.languagePairs.map((pair) => `<option value="${pair.id}" ${pair.id === (editingCard?.pairId || draft?.pairId || context.currentPair?.id) ? "selected" : ""}>${esc(pairLabel(pair))}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>カード種別 *</span>
            <select name="type" required>
              ${CARD_TYPES.map((type) => `<option value="${type.value}" ${type.value === initialType ? "selected" : ""}>${type.label}</option>`).join("")}
            </select>
          </label>
          ${input("expression", "表現", true, "例: be in luck")}
          ${input("translation", "訳", false, "フレーズ向け")}
          ${input("tags", "タグ", false, "例: 日常会話, 旅行, 映画")}
          ${textarea("meaning", "意味", "イディオム向け")}
          ${textarea("example", "例文", "イディオム向け")}
          ${textarea("exampleTranslation", "例文訳", "イディオム向け")}
          ${textarea("nuance", "ニュアンス", "イディオム向け / フレーズでも補足可")}
          ${textarea("notes", "備考 / 由来メモ", "フレーズ向け")}
          <label class="field">
            <span>Confidence</span>
            <select name="confidence">
              <option value="0">未設定</option>
              <option value="1">星1</option>
              <option value="2">星2</option>
              <option value="3">星3</option>
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

    view.querySelector("#card-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const card = collectCardForm(event.currentTarget);
      if (!card.expression) {
        alert("表現は必須です。");
        return;
      }
      if (editingCard) {
        store.updateCard(editingCard.id, card);
        sessionStorage.removeItem("phrase-forge:draft");
        navigateWithFlash(`#/cards/${editingCard.id}`, "カードを更新しました。");
        return;
      }
      const created = store.addCard(card);
      sessionStorage.removeItem("phrase-forge:draft");
      navigateWithFlash(`#/cards/${created.id}`, "カードを保存しました。");
    });

    view.querySelector("#generate-button-top").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const form = view.querySelector("#card-form");
      const partial = collectCardForm(form);
      if (!partial.expression) {
        alert("先に表現を入力してください。");
        return;
      }
      if (!state.settings.openAiApiKey) {
        alert("先に設定画面で OpenAI API キーを入力してください。");
        return;
      }

      button.disabled = true;
      button.textContent = "生成中...";

      try {
        const pair = getPairById(context.languagePairs, partial.pairId) || context.currentPair;
        const generated = await generator.generateDraft({
          apiKey: state.settings.openAiApiKey,
          model: state.settings.openAiModel,
          nativeLanguage: pair?.nativeLanguage || "日本語",
          targetLanguage: pair?.targetLanguage || "英語",
          type: partial.type,
          expression: partial.expression,
        });

        fillCardForm(view, {
          ...partial,
          ...generated,
          tags: mergeTags(partial.tags, generated.tags || []),
        });
        syncTypeHints(form);
        showInlineFlash("AIで下書きを生成しました。必要に応じて調整してから保存してください。");
      } catch (error) {
        alert(formatApiError(error));
      } finally {
        button.disabled = false;
        button.textContent = "生成";
      }
    });
  }

  function renderCardDetail(view, state, context, cardId) {
    const card = getCardById(context.cards, cardId);
    if (!card) {
      navigateWithFlash("#/cards", "カードが見つからなかったため一覧へ戻しました。");
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
            <a class="button button-secondary" href="#/cards" data-route>一覧へ戻る</a>
            <a class="button button-primary" href="#/cards/${card.id}/edit" data-route>編集</a>
            <button id="delete-card-button" type="button" class="button button-secondary">削除</button>
          </div>
        </div>

        <div class="grid-2">
          <section class="panel">
            <h3>意味と補足</h3>
            ${definition("訳", card.translation)}
            ${definition("意味", card.meaning)}
            ${definition("ニュアンス", card.nuance)}
            ${definition("備考 / 由来メモ", card.notes)}
          </section>
          <section class="panel">
            <h3>例文</h3>
            ${richDefinition("例文", highlightExpression(card.example, card.expression, card.type))}
            ${definition("例文訳", card.exampleTranslation)}
            ${definition("タグ", card.tags.join(", "))}
            ${definition("更新日時", formatDateTime(card.updatedAt))}
          </section>
        </div>
      </section>
    `;

    view.querySelector("#delete-card-button").addEventListener("click", () => {
      if (!confirm(`「${card.expression}」を削除します。`)) {
        return;
      }
      store.deleteCard(card.id);
      navigateWithFlash("#/cards", "カードを削除しました。");
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
              <span>学習タグ</span>
              <select name="tag">
                <option value="">すべて</option>
                ${allTags.map((tag) => `<option value="${esc(tag)}" ${tag === selectedTag ? "selected" : ""}>${esc(tag)}</option>`).join("")}
              </select>
            </label>
            <button type="submit" class="button button-secondary">条件を更新</button>
          </form>
        </section>
        <div id="study-region"></div>
      </section>
    `;

    const studyRegion = view.querySelector("#study-region");

    const draw = () => {
      const cards = filterStudyCards(context.cardsForCurrentPair, sessionStorage.getItem("phrase-forge:study-tag") || "");
      if (!cards.length) {
        studyRegion.innerHTML = `<div class="empty-state">条件に合う学習カードがありません。</div>`;
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
              <dt>訳</dt>
              <dd>${esc(card.translation || card.meaning || "未入力")}</dd>
              <dt>ニュアンス</dt>
              <dd>${esc(card.nuance || card.notes || "未入力")}</dd>
            </dl>
          </div>
          <div class="study-actions">
            <button type="button" class="button button-secondary" id="prev-card">前へ</button>
            <div class="confidence-row">
              <span>Confidence</span>
              <div class="star-group">${renderStarButtons(card.id, card.confidence, true)}</div>
            </div>
            <button type="button" class="button button-primary" id="next-card">次へ</button>
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
            ${input("googleClientId", "Google Client ID", false, "xxxx.apps.googleusercontent.com")}
            ${input("openAiModel", "OpenAI モデル", true, "例: gpt-4.1-mini")}
            ${input("homeTagLimit", "ホームタグ数", true, "例: 5", "number")}
            <label class="field span-2">
              <span>OpenAI API キー</span>
              <input name="openAiApiKey" type="password" placeholder="sk-..." autocomplete="off" />
            </label>
            <div class="form-actions">
              <button type="submit" class="button button-primary">設定を保存</button>
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
                  <p>${pair.id === context.currentPair?.id ? "現在選択中です。" : "切り替えて使えます。"}</p>
                </div>
                <div class="row-actions">
                  <button type="button" class="button button-secondary" data-activate-pair="${pair.id}">切り替え</button>
                  <button type="button" class="button button-secondary" data-edit-pair="${pair.id}">編集</button>
                  <button type="button" class="button button-secondary" data-delete-pair="${pair.id}">削除</button>
                </div>
              </article>
            `).join("")}
          </div>
          <form id="pair-form" class="form-grid with-top-gap">
            <input type="hidden" name="pairId" value="${esc(editingPair?.id || "")}" />
            ${input("pairName", "表示名", false, "例: 日本語 → 英語")}
            ${input("nativeLanguage", "母国語", true, "例: 日本語")}
            ${input("targetLanguage", "習得言語", true, "例: 英語")}
            <div class="form-actions">
              <button type="submit" class="button button-secondary">${editingPair ? "言語ペアを更新" : "言語ペアを追加"}</button>
              ${editingPair ? '<button type="button" class="button button-secondary" id="cancel-pair-edit">編集をやめる</button>' : ""}
            </div>
          </form>
        </section>
      </section>
    `;

    setValue(view, "googleClientId", state.settings.googleClientId);
    setValue(view, "openAiModel", state.settings.openAiModel);
    setValue(view, "homeTagLimit", String(state.settings.homeTagLimit || 5));
    setValue(view, "openAiApiKey", state.settings.openAiApiKey);
    if (editingPair) {
      setValue(view, "pairName", editingPair.name);
      setValue(view, "nativeLanguage", editingPair.nativeLanguage);
      setValue(view, "targetLanguage", editingPair.targetLanguage);
    }

    view.querySelectorAll("[data-activate-pair]").forEach((button) => {
      button.addEventListener("click", (event) => {
        store.updateActivePair(event.currentTarget.getAttribute("data-activate-pair"));
        showFlash("言語ペアを切り替えました。");
      });
    });

    view.querySelectorAll("[data-edit-pair]").forEach((button) => {
      button.addEventListener("click", (event) => {
        sessionStorage.setItem("phrase-forge:editing-pair", event.currentTarget.getAttribute("data-edit-pair"));
        render();
      });
    });

    view.querySelectorAll("[data-delete-pair]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const pairId = event.currentTarget.getAttribute("data-delete-pair");
        const pair = getPairById(context.languagePairs, pairId);
        if (!pair) {
          return;
        }
        if (!confirm(`「${pairLabel(pair)}」を削除します。この言語ペアのカードも一緒に削除されます。`)) {
          return;
        }
        const result = store.deleteLanguagePair(pairId);
        if (!result?.ok) {
          if (result?.reason === "last_pair") {
            alert("最後の1件の言語ペアは削除できません。");
            return;
          }
          alert("言語ペアを削除できませんでした。");
          return;
        }
        if (editingPairId === pairId) {
          sessionStorage.removeItem("phrase-forge:editing-pair");
        }
        showFlash("言語ペアを削除しました。");
      });
    });

    const cancelButton = view.querySelector("#cancel-pair-edit");
    if (cancelButton) {
      cancelButton.addEventListener("click", () => {
        sessionStorage.removeItem("phrase-forge:editing-pair");
        render();
      });
    }

    view.querySelector("#pair-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const input = {
        name: data.get("pairName")?.toString().trim(),
        nativeLanguage: data.get("nativeLanguage")?.toString().trim(),
        targetLanguage: data.get("targetLanguage")?.toString().trim(),
      };
      const pairId = data.get("pairId")?.toString().trim();
      if (pairId) {
        const updated = store.updateLanguagePair(pairId, input);
        if (!updated) {
          alert("言語ペアを更新できませんでした。");
          return;
        }
        store.updateActivePair(updated.id);
        sessionStorage.removeItem("phrase-forge:editing-pair");
        showFlash("言語ペアを更新しました。");
        return;
      }
      const pair = store.addLanguagePair(input);
      store.updateActivePair(pair.id);
      showFlash("言語ペアを追加しました。");
    });

    view.querySelector("#settings-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      store.updateSettings({
        googleClientId: data.get("googleClientId")?.toString().trim(),
        openAiModel: data.get("openAiModel")?.toString().trim(),
        homeTagLimit: data.get("homeTagLimit")?.toString().trim(),
        openAiApiKey: data.get("openAiApiKey")?.toString().trim(),
      });
      showFlash("設定を保存しました。");
    });
  }

  function bindConfidenceButtons(scope) {
    scope.querySelectorAll("[data-confidence-card]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const cardId = event.currentTarget.getAttribute("data-confidence-card");
        const level = Number(event.currentTarget.getAttribute("data-confidence-level") || 0);
        store.updateCardConfidence(cardId, level);
        render();
      });
    });
  }

  function bindCardDeleteButtons(scope) {
    scope.querySelectorAll("[data-delete-card]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const cardId = event.currentTarget.getAttribute("data-delete-card");
        const card = getCardById(store.getState().cards.filter((item) => item.ownerId === getOwnerId(store.getState())), cardId);
        if (!card) {
          return;
        }
        if (!confirm(`「${card.expression}」を削除します。`)) {
          return;
        }
        store.deleteCard(cardId);
        showFlash("カードを削除しました。");
      });
    });
  }

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
    home: "ホーム",
    cards: "カード一覧",
    "card-new": "カード作成",
    "card-detail": "カード詳細",
    "card-edit": "カード編集",
    study: "学習モード",
    settings: "設定",
  }[route.name] || "Phrase Forge";
}

function nav(href, label, active) {
  return `<a class="nav-link ${active ? "is-active" : ""}" href="${href}" data-route>${label}</a>`;
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
        <p>${esc(card.translation || card.meaning || "訳未入力")}</p>
      </div>
      <a class="button button-secondary" href="#/cards/${card.id}" data-route>詳細</a>
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
          <span class="preview-label">例文</span>
          <div class="preview-value">${highlightExpression(card.example || "未入力", card.expression, card.type)}</div>
        </div>
      ` : ""}
      <div class="preview-block">
        <span class="preview-label">訳</span>
        <p class="card-copy">${esc(card.translation || card.meaning || "未入力")}</p>
      </div>
      <div class="preview-block">
        <span class="preview-label">ニュアンス</span>
        <p class="card-note">${esc(card.nuance || card.notes || "未入力")}</p>
      </div>
      <div class="card-actions">
        <a class="button button-primary" href="#/cards/${card.id}" data-route>詳細</a>
        <a class="button button-secondary" href="#/cards/${card.id}/edit" data-route>編集</a>
        <button type="button" class="button button-secondary" data-delete-card="${card.id}">削除</button>
      </div>
    </article>
  `;
}

function definition(label, value) {
  return `<dl class="definition"><dt>${esc(label)}</dt><dd>${esc(value || "未入力")}</dd></dl>`;
}

function richDefinition(label, html) {
  return `<dl class="definition"><dt>${esc(label)}</dt><dd>${html || "未入力"}</dd></dl>`;
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
  return [...new Set(cards.flatMap((card) => card.tags))].sort((left, right) => left.localeCompare(right, "ja"));
}

function getCardById(cards, cardId) {
  return cards.find((card) => card.id === cardId);
}

function getPairById(pairs, pairId) {
  return pairs.find((pair) => pair.id === pairId);
}

function pairLabel(pair) {
  if (!pair) {
    return "未設定";
  }
  return pair.name || `${pair.nativeLanguage} → ${pair.targetLanguage}`;
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
      return `<button type="button" class="star-button ${active ? "is-active" : ""} ${filledOnly ? "is-solid" : ""}" data-confidence-card="${cardId}" data-confidence-level="${level}" aria-label="Confidence ${level}">${active ? "★" : "☆"}</button>`;
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
      return left[0].localeCompare(right[0], "ja");
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
  const message = error?.message || "生成に失敗しました。";
  if (message.includes("insufficient_quota") || message.includes("429")) {
    return "OpenAI API の利用上限に達しています。Billing または残高をご確認ください。";
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
