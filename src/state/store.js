import { createStorage } from "../services/storage.js";
import { createSampleData } from "../data/sampleData.js";

const GUEST_OWNER_ID = "guest-local";

export function createStore({ storage = createStorage(), defaultOpenAiModel = "gpt-4.1-mini" } = {}) {
  const initialState = storage.loadLocal() || createSampleData();
  let state = normalizeState(initialState, defaultOpenAiModel);

  storage.saveLocal(state);

  function getState() {
    return state;
  }

  function getOwnerId() {
    return state.settings.currentUser?.id || GUEST_OWNER_ID;
  }

  async function persistCurrentOwner() {
    storage.saveLocal(state);
    const ownerId = getOwnerId();
    if (ownerId === GUEST_OWNER_ID) {
      return;
    }
    await storage.saveRemote(ownerId, workspaceFromState(state, ownerId));
  }

  async function addCard(input) {
    const timestamp = new Date().toISOString();
    const card = {
      id: crypto.randomUUID(),
      ...normalizeCardInput(input),
      ownerId: getOwnerId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    state = {
      ...state,
      cards: [card, ...state.cards],
    };
    await persistCurrentOwner();
    return card;
  }

  async function updateCard(cardId, input) {
    const existing = state.cards.find((card) => card.id === cardId && card.ownerId === getOwnerId());
    if (!existing) {
      return null;
    }

    const updated = {
      ...existing,
      ...normalizeCardInput(input),
      ownerId: existing.ownerId,
      updatedAt: new Date().toISOString(),
    };

    state = {
      ...state,
      cards: state.cards.map((card) => (card.id === cardId ? updated : card)),
    };
    await persistCurrentOwner();
    return updated;
  }

  async function updateCardConfidence(cardId, confidence) {
    const existing = state.cards.find((card) => card.id === cardId && card.ownerId === getOwnerId());
    if (!existing) {
      return null;
    }
    const nextConfidence = Number(existing.confidence || 0) === Number(confidence || 0) ? 0 : confidence;
    return updateCard(cardId, {
      ...existing,
      confidence: nextConfidence,
    });
  }

  async function deleteCard(cardId) {
    const exists = state.cards.some((card) => card.id === cardId && card.ownerId === getOwnerId());
    if (!exists) {
      return false;
    }
    state = {
      ...state,
      cards: state.cards.filter((card) => !(card.id === cardId && card.ownerId === getOwnerId())),
    };
    await persistCurrentOwner();
    return true;
  }

  async function addLanguagePair(input) {
    const pair = normalizeLanguagePair({
      id: crypto.randomUUID(),
      name: input.name,
      nativeLanguage: input.nativeLanguage,
      targetLanguage: input.targetLanguage,
      ownerId: getOwnerId(),
    });

    state = {
      ...state,
      languagePairs: [...state.languagePairs, pair],
      settings: {
        ...state.settings,
        activePairId: pair.id,
        updatedAt: new Date().toISOString(),
      },
    };
    await persistCurrentOwner();
    return pair;
  }

  async function updateLanguagePair(pairId, input) {
    const existing = state.languagePairs.find((pair) => pair.id === pairId && pair.ownerId === getOwnerId());
    if (!existing) {
      return null;
    }

    const updated = normalizeLanguagePair({
      ...existing,
      name: input.name,
      nativeLanguage: input.nativeLanguage,
      targetLanguage: input.targetLanguage,
    });

    state = {
      ...state,
      languagePairs: state.languagePairs.map((pair) => (pair.id === pairId ? updated : pair)),
    };
    await persistCurrentOwner();
    return updated;
  }

  async function deleteLanguagePair(pairId) {
    const ownerId = getOwnerId();
    const ownerPairs = state.languagePairs.filter((pair) => pair.ownerId === ownerId);
    const existing = ownerPairs.find((pair) => pair.id === pairId);
    if (!existing) {
      return { ok: false, reason: "not_found" };
    }
    if (ownerPairs.length <= 1) {
      return { ok: false, reason: "last_pair" };
    }

    const nextPairs = state.languagePairs.filter((pair) => pair.id !== pairId);
    const nextOwnerPairs = nextPairs.filter((pair) => pair.ownerId === ownerId);

    state = {
      ...state,
      languagePairs: nextPairs,
      cards: state.cards.filter((card) => !(card.ownerId === ownerId && card.pairId === pairId)),
      settings: {
        ...state.settings,
        activePairId: state.settings.activePairId === pairId ? nextOwnerPairs[0]?.id || "" : state.settings.activePairId,
        updatedAt: new Date().toISOString(),
      },
    };
    await persistCurrentOwner();
    return { ok: true };
  }

  async function updateActivePair(pairId) {
    const exists = state.languagePairs.some((pair) => pair.id === pairId && pair.ownerId === getOwnerId());
    if (!exists) {
      return null;
    }
    state = {
      ...state,
      settings: {
        ...state.settings,
        activePairId: pairId,
        updatedAt: new Date().toISOString(),
      },
    };
    await persistCurrentOwner();
    return pairId;
  }

  async function updateCurrentUser(user) {
    const ownerId = user?.id || GUEST_OWNER_ID;
    state = {
      ...state,
      settings: {
        ...state.settings,
        currentUser: normalizeCurrentUser(user),
        updatedAt: new Date().toISOString(),
      },
    };
    state = ensureWorkspaceForOwner(state, ownerId);
    storage.saveLocal(state);

    if (ownerId === GUEST_OWNER_ID) {
      return state.settings.currentUser;
    }

    const remoteWorkspace = await storage.loadRemote(ownerId);
    if (remoteWorkspace) {
      state = applyWorkspace(state, ownerId, remoteWorkspace, defaultOpenAiModel);
      storage.saveLocal(state);
      return state.settings.currentUser;
    }

    await storage.saveRemote(ownerId, workspaceFromState(state, ownerId));
    return state.settings.currentUser;
  }

  async function updateSettings(input) {
    state = {
      ...state,
      settings: {
        ...state.settings,
        openAiModel: input.openAiModel || state.settings.openAiModel,
        homeTagLimit: clampHomeTagLimit(input.homeTagLimit ?? state.settings.homeTagLimit),
        homeExamplesPerPage: clampHomeExamplesPerPage(input.homeExamplesPerPage ?? state.settings.homeExamplesPerPage),
        cardsPerPage: clampCardsPerPage(input.cardsPerPage ?? state.settings.cardsPerPage),
        updatedAt: new Date().toISOString(),
      },
    };
    await persistCurrentOwner();
    return state.settings;
  }

  function resetSampleData() {
    state = normalizeState(createSampleData(), defaultOpenAiModel);
    storage.resetWith(state);
  }

  return {
    getState,
    addCard,
    updateCard,
    updateCardConfidence,
    deleteCard,
    addLanguagePair,
    updateLanguagePair,
    deleteLanguagePair,
    updateActivePair,
    updateCurrentUser,
    updateSettings,
    resetSampleData,
  };
}

function normalizeState(input, defaultOpenAiModel) {
  const languagePairs = Array.isArray(input.languagePairs) && input.languagePairs.length
    ? input.languagePairs.map(normalizeLanguagePair)
    : [
        normalizeLanguagePair({
          id: "pair-default",
          name: "Japanese -> English",
          nativeLanguage: "Japanese",
          targetLanguage: "English",
          ownerId: GUEST_OWNER_ID,
        }),
      ];

  const state = {
    languagePairs,
    cards: Array.isArray(input.cards) ? input.cards.map((card) => normalizeCard(card, languagePairs[0].id)) : [],
    settings: {
      activePairId: input.settings?.activePairId || languagePairs[0].id,
      openAiModel: input.settings?.openAiModel || defaultOpenAiModel,
      homeTagLimit: clampHomeTagLimit(input.settings?.homeTagLimit || 5),
      homeExamplesPerPage: clampHomeExamplesPerPage(input.settings?.homeExamplesPerPage || 8),
      cardsPerPage: clampCardsPerPage(input.settings?.cardsPerPage || 12),
      currentUser: normalizeCurrentUser(input.settings?.currentUser),
      updatedAt: input.settings?.updatedAt || "",
    },
  };

  return ensureWorkspaceForOwner(state, state.settings.currentUser?.id || GUEST_OWNER_ID);
}

function normalizeCurrentUser(user) {
  if (!user?.id) {
    return null;
  }
  return {
    id: user.id,
    name: user.name || "",
    email: user.email || "",
    picture: user.picture || "",
  };
}

function normalizeLanguagePair(pair) {
  return {
    id: pair.id || crypto.randomUUID(),
    ownerId: pair.ownerId || GUEST_OWNER_ID,
    name: pair.name?.toString().trim() || "",
    nativeLanguage: pair.nativeLanguage?.toString().trim() || "Japanese",
    targetLanguage: pair.targetLanguage?.toString().trim() || "English",
  };
}

function normalizeCard(card, fallbackPairId) {
  return {
    id: card.id || crypto.randomUUID(),
    ownerId: card.ownerId || GUEST_OWNER_ID,
    pairId: card.pairId || fallbackPairId,
    type: card.type === "phrase" ? "phrase" : "idiom",
    expression: card.expression || "",
    translation: card.translation || "",
    meaning: card.meaning || "",
    example: card.example || "",
    exampleTranslation: card.exampleTranslation || "",
    nuance: card.nuance || "",
    notes: card.notes || "",
    tags: normalizeTags(card.tags),
    confidence: clampConfidence(card.confidence),
    source: card.source === "ai" ? "ai" : "manual",
    createdAt: card.createdAt || new Date().toISOString(),
    updatedAt: card.updatedAt || card.createdAt || new Date().toISOString(),
  };
}

function normalizeCardInput(input) {
  return {
    pairId: input.pairId?.toString() || "",
    type: input.type === "phrase" ? "phrase" : "idiom",
    expression: input.expression?.toString().trim() || "",
    translation: input.translation?.toString().trim() || "",
    meaning: input.meaning?.toString().trim() || "",
    example: input.example?.toString().trim() || "",
    exampleTranslation: input.exampleTranslation?.toString().trim() || "",
    nuance: input.nuance?.toString().trim() || "",
    notes: input.notes?.toString().trim() || "",
    tags: normalizeTags(input.tags),
    confidence: clampConfidence(input.confidence),
    source: input.source === "ai" ? "ai" : "manual",
  };
}

function ensureWorkspaceForOwner(state, ownerId) {
  const ownerPairs = state.languagePairs.filter((pair) => pair.ownerId === ownerId);
  if (!ownerPairs.length) {
    const pair = normalizeLanguagePair({
      id: crypto.randomUUID(),
      ownerId,
      name: "Japanese -> English",
      nativeLanguage: "Japanese",
      targetLanguage: "English",
    });
    return {
      ...state,
      languagePairs: [...state.languagePairs, pair],
      settings: {
        ...state.settings,
        activePairId: pair.id,
      },
    };
  }

  if (!ownerPairs.some((pair) => pair.id === state.settings.activePairId)) {
    return {
      ...state,
      settings: {
        ...state.settings,
        activePairId: ownerPairs[0].id,
      },
    };
  }

  return state;
}

function normalizeTags(value) {
  const rawItems = Array.isArray(value) ? value : (value?.toString() || "").split(/[,\n、]/);
  return rawItems
    .map((item) => item?.toString().trim())
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function clampConfidence(value) {
  const numeric = Number(value || 0);
  if (Number.isNaN(numeric) || numeric < 0) {
    return 0;
  }
  if (numeric > 3) {
    return 3;
  }
  return Math.round(numeric);
}

function clampHomeTagLimit(value) {
  const numeric = Number(value || 5);
  if (Number.isNaN(numeric) || numeric < 1) {
    return 5;
  }
  if (numeric > 20) {
    return 20;
  }
  return Math.round(numeric);
}

function clampCardsPerPage(value) {
  const numeric = Number(value || 12);
  if (Number.isNaN(numeric) || numeric < 4) {
    return 12;
  }
  if (numeric > 48) {
    return 48;
  }
  return Math.round(numeric);
}

function clampHomeExamplesPerPage(value) {
  const numeric = Number(value || 8);
  if (Number.isNaN(numeric) || numeric < 4) {
    return 8;
  }
  if (numeric > 48) {
    return 48;
  }
  return Math.round(numeric);
}

function workspaceFromState(state, ownerId) {
  return {
    languagePairs: state.languagePairs
      .filter((pair) => pair.ownerId === ownerId)
      .map(({ ownerId: _ownerId, ...pair }) => pair),
    cards: state.cards
      .filter((card) => card.ownerId === ownerId)
      .map(({ ownerId: _ownerId, ...card }) => card),
    settings: {
      activePairId: state.settings.activePairId,
      openAiModel: state.settings.openAiModel,
      homeTagLimit: state.settings.homeTagLimit,
      homeExamplesPerPage: state.settings.homeExamplesPerPage,
      cardsPerPage: state.settings.cardsPerPage,
    },
  };
}

function applyWorkspace(state, ownerId, workspace, defaultOpenAiModel) {
  const nextPairs = (workspace.languagePairs || []).map((pair) => normalizeLanguagePair({ ...pair, ownerId }));
  const fallbackPairId = nextPairs[0]?.id || crypto.randomUUID();
  const nextCards = (workspace.cards || []).map((card) => normalizeCard({ ...card, ownerId }, fallbackPairId));

  const merged = {
    ...state,
    languagePairs: [
      ...state.languagePairs.filter((pair) => pair.ownerId !== ownerId),
      ...nextPairs,
    ],
    cards: [
      ...state.cards.filter((card) => card.ownerId !== ownerId),
      ...nextCards,
    ],
    settings: {
      ...state.settings,
      activePairId: workspace.settings?.activePairId || nextPairs[0]?.id || state.settings.activePairId,
      openAiModel: workspace.settings?.openAiModel || state.settings.openAiModel || defaultOpenAiModel,
      homeTagLimit: clampHomeTagLimit(workspace.settings?.homeTagLimit || state.settings.homeTagLimit),
      homeExamplesPerPage: clampHomeExamplesPerPage(workspace.settings?.homeExamplesPerPage || state.settings.homeExamplesPerPage),
      cardsPerPage: clampCardsPerPage(workspace.settings?.cardsPerPage || state.settings.cardsPerPage),
    },
  };

  return ensureWorkspaceForOwner(merged, ownerId);
}
