const BASE_SCORES = {
  previousTopics: 5,
  recentTopics: 4,
  frequentTopics: 3,
  personHobbies: 4,
  personInterests: 3,
  selfHobbies: 2,
  selfInterests: 2,
  selfRecentTopics: 1,
};

const BOOST_SCORES = {
  commonGround: 3,
  previousAndProfile: 2,
  recentAndFrequent: 2,
  weakTopicPenalty: -2,
  legacySummaryPenalty: -3,
};

const SCENARIO_BONUS = {
  初対面: { personHobbies: 1, personInterests: 1, commonGround: 1, previousTopics: -1 },
  久しぶり: { previousTopics: 2, recentTopics: 1 },
  会食: { personHobbies: 1, selfRecentTopics: 1, commonGround: 1 },
  雑談: { recentTopics: 1, selfRecentTopics: 1 },
  商談: { previousTopics: 1, personInterests: 2, frequentTopics: 1 },
};

export function createConversationSuggestionService() {
  function generateSuggestion({ person, selfProfile, logs, scenario }) {
    const sortedLogs = [...logs].sort((left, right) => (right.date || "").localeCompare(left.date || ""));
    const latestLog = sortedLogs[0];
    const topicSummary = summarizeLogTopics(sortedLogs);
    const avoidTopics = uniqueList(person.difficultTopics).slice(0, 4);
    const commonGround = filterAllowedTopics(collectCommonGround(person, selfProfile), avoidTopics);
    const scoredTopics = scoreTopics({
      person,
      selfProfile,
      topicSummary,
      scenario,
      avoidTopics,
      commonGround,
      weakTopics: pickMatchingWeakTopics(person, selfProfile),
    });
    const continuationIdeas = buildContinuationIdeas(person, latestLog, scoredTopics, avoidTopics);
    const selfTopics = buildSelfTopics(selfProfile, scoredTopics, avoidTopics);
    const recommendedTopics = buildRecommendedTopics(scoredTopics, avoidTopics);

    return {
      personId: person.id,
      scenario,
      openingLine: buildOpeningLine(person, scenario, latestLog, commonGround),
      recommendedTopics,
      deepDiveQuestions: buildDeepDiveQuestions(person, commonGround, topicSummary, scenario, avoidTopics),
      selfTopics,
      commonGround,
      avoidTopics,
      continuationIdeas,
      topicSummary,
      scoredTopics,
    };
  }

  return {
    generateSuggestion,
  };
}

function buildOpeningLine(person, scenario, latestLog, commonGround) {
  const tone = {
    初対面: `今日はよろしくお願いします。${person.name}さんが話しやすそうなところから伺えたらうれしいです。`,
    久しぶり: `${person.name}さん、お久しぶりです。`,
    会食: `${person.name}さん、今日はご一緒できてうれしいです。`,
    雑談: `${person.name}さん、最近どうですか。`,
    商談: `${person.name}さん、本題の前に少しだけ近況を伺っても大丈夫ですか。`,
  };

  if (latestLog?.topics?.[0]) {
    if (scenario === "久しぶり") {
      return `${person.name}さん、お久しぶりです。前に出ていた「${latestLog.topics[0]}」のその後、最近どうでしたか。`;
    }
    if (scenario === "雑談" || scenario === "会食") {
      return `${tone[scenario]} 前に話していた「${latestLog.topics[0]}」の続き、最近どうなりましたか。`;
    }
  }

  if (commonGround[0]) {
    if (scenario === "初対面") {
      return `${person.name}さん、今日はよろしくお願いします。${commonGround[0]}がお好きと見て、その話から少し伺ってもいいですか。`;
    }
    if (scenario === "商談") {
      return `${tone[scenario]} ${commonGround[0]}の話なら自然に入りやすそうなので、少しだけその話題から始めさせてください。`;
    }
  }

  return tone[scenario] || tone["雑談"];
}

function buildRecommendedTopics(scoredTopics, avoidTopics) {
  return filterAllowedTopics(
    pickTopEntries(scoredTopics, {
      limit: 3,
      predicate: (entry) => hasAnySource(entry, ["previousTopics", "recentTopics", "frequentTopics", "personHobbies", "personInterests", "commonGround"]),
    }).map((entry) => formatRecommendedTopic(entry)),
    avoidTopics,
  );
}

function buildContinuationIdeas(person, latestLog, scoredTopics, avoidTopics) {
  const latestTopic = latestLog?.topics?.[0] || "";
  const candidates = [];

  if (latestTopic) {
    candidates.push(`前回の「${latestTopic}」の続きから入る`);
  }
  if (latestLog?.note) {
    candidates.push(`前回メモ: ${latestLog.note}`);
  }

  const nextTopic = pickTopEntries(scoredTopics, {
    limit: 2,
    predicate: (entry) => hasAnySource(entry, ["previousTopics", "recentTopics", "frequentTopics"]),
  }).find((entry) => entry.topic !== latestTopic);

  if (nextTopic) {
    candidates.push(`よくつながる話題の「${nextTopic.topic}」を次の入口にする`);
  }
  if (person.nextTopicMemo) {
    candidates.push(`人物メモにある次回話題: ${person.nextTopicMemo}`);
  }

  return filterAllowedTopics(uniqueList(candidates), avoidTopics).slice(0, 2);
}

function buildSelfTopics(selfProfile, scoredTopics, avoidTopics) {
  const items = pickTopEntries(scoredTopics, {
    limit: 2,
    predicate: (entry) => hasAnySource(entry, ["commonGround", "selfHobbies", "selfInterests", "selfRecentTopics"]),
  }).map((entry) => {
    if (hasAnySource(entry, ["commonGround"])) {
      return `自分の${entry.topic}の体験を短く返せる`;
    }
    if (hasAnySource(entry, ["selfRecentTopics"])) {
      return `自分の最近の${entry.topic}の話を短く出せる`;
    }
    return `自分からは${entry.topic}に近い話題を出せる`;
  });

  if (!items.length && selfProfile.recentTopics[0]) {
    items.push(`自分の最近の話題: ${selfProfile.recentTopics[0]}`);
  }

  return filterAllowedTopics(uniqueList(items), avoidTopics).slice(0, 2);
}

function buildDeepDiveQuestions(person, commonGround, topicSummary, scenario, avoidTopics) {
  const scenarioLead = {
    初対面: "話しやすい範囲で",
    久しぶり: "その後の変化として",
    会食: "気軽な話として",
    雑談: "近況として",
    商談: "差し支えなければ",
  };

  const questions = uniqueList([
    topicSummary.previousTopics[0] ? `${scenarioLead[scenario]}、「${topicSummary.previousTopics[0]}」は最近どうですか。` : "",
    topicSummary.frequentTopics[0] ? `${topicSummary.frequentTopics[0]}の中で、最近いちばん印象に残ったことは何ですか。` : "",
    person.interests[0] ? `${person.interests[0]}に興味を持ったきっかけって何だったんですか。` : "",
    person.hobbies[0] ? `${person.hobbies[0]}は最近も続いていますか。` : "",
  ]);

  return filterAllowedTopics(questions, avoidTopics).slice(0, 3);
}

function scoreTopics({ person, selfProfile, topicSummary, scenario, avoidTopics, commonGround, weakTopics }) {
  const entries = new Map();
  const personProfileTopics = uniqueList([...person.hobbies, ...person.interests, ...person.likes]);
  const selfTopics = uniqueList([...selfProfile.hobbies, ...selfProfile.interests, ...selfProfile.recentTopics]);
  addTopics(entries, topicSummary.previousTopics, "previousTopics");
  addTopics(entries, topicSummary.recentTopics, "recentTopics");
  addTopics(entries, topicSummary.frequentTopics, "frequentTopics");
  addTopics(entries, person.hobbies, "personHobbies");
  addTopics(entries, person.interests, "personInterests");
  addTopics(entries, selfProfile.hobbies, "selfHobbies");
  addTopics(entries, selfProfile.interests, "selfInterests");
  addTopics(entries, selfProfile.recentTopics, "selfRecentTopics");

  for (const entry of entries.values()) {
    if (matchesAny(entry.topic, avoidTopics)) {
      entry.excluded = true;
      entry.reasons.push("苦手そうな話題に近いため除外");
      continue;
    }

    entry.score += sumSourceScores(entry.sources, scenario);

    if (matchesAny(entry.topic, commonGround)) {
      entry.score += BOOST_SCORES.commonGround + scenarioBonus(scenario, "commonGround");
      entry.reasons.push("相手と自分の共通点");
    }

    if (entry.sources.has("previousTopics") && matchesAny(entry.topic, personProfileTopics)) {
      entry.score += BOOST_SCORES.previousAndProfile;
      entry.reasons.push("前回の話題で、相手プロフィールにも近い");
    }

    if (entry.sources.has("recentTopics") && entry.sources.has("frequentTopics")) {
      entry.score += BOOST_SCORES.recentAndFrequent;
      entry.reasons.push("最近もよく出ている話題");
    }

    if (matchesAny(entry.topic, selfTopics) && matchesAny(entry.topic, personProfileTopics)) {
      entry.score += BOOST_SCORES.commonGround;
      entry.reasons.push("相手と自分の両方から出せる");
    }

    if (matchesAny(entry.topic, weakTopics || [])) {
      entry.score += BOOST_SCORES.weakTopicPenalty;
      entry.reasons.push("自分の苦手話題に近い");
    }

    if (looksLikeLegacySummary(entry.topic)) {
      entry.score += BOOST_SCORES.legacySummaryPenalty;
      entry.reasons.push("旧要約文らしく長いため優先度を下げる");
    }
  }

  return [...entries.values()]
    .filter((entry) => !entry.excluded)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.sources.size !== left.sources.size) return right.sources.size - left.sources.size;
      return left.topic.localeCompare(right.topic, "ja");
    });
}

function addTopics(entries, topics, source) {
  for (const topic of normalizeTopics(topics)) {
    const key = topic.toLowerCase();
    const entry = entries.get(key) || {
      topic,
      score: 0,
      sources: new Set(),
      reasons: [],
      excluded: false,
    };
    entry.sources.add(source);
    entries.set(key, entry);
  }
}

function sumSourceScores(sources, scenario) {
  let score = 0;
  for (const source of sources) {
    score += BASE_SCORES[source] || 0;
    score += scenarioBonus(scenario, source);
  }
  return score;
}

function scenarioBonus(scenario, key) {
  return SCENARIO_BONUS[scenario]?.[key] || 0;
}

function pickTopEntries(entries, { limit, predicate }) {
  const selected = [];

  for (const entry of entries) {
    if (predicate && !predicate(entry)) {
      continue;
    }
    if (selected.some((item) => sharesCoreTopic(item.topic, entry.topic))) {
      continue;
    }
    selected.push(entry);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function formatRecommendedTopic(entry) {
  if (hasAnySource(entry, ["previousTopics"])) {
    return `前回も出た「${entry.topic}」`;
  }
  if (hasAnySource(entry, ["commonGround"])) {
    return `共通点として話しやすい${entry.topic}`;
  }
  if (hasAnySource(entry, ["personHobbies", "personInterests"])) {
    return `${entry.topic}の話`;
  }
  return `最近つなげやすい${entry.topic}`;
}

function summarizeLogTopics(logs) {
  const counts = new Map();
  const recentCounts = new Map();
  const previousTopics = usableTopics(logs[0]?.topics);

  logs.forEach((log, index) => {
    usableTopics(log.topics).forEach((topic) => {
      counts.set(topic, (counts.get(topic) || 0) + 1);
      if (index < 3) {
        recentCounts.set(topic, (recentCounts.get(topic) || 0) + 1);
      }
    });
  });

  return {
    previousTopics,
    frequentTopics: rankedTopics(counts),
    recentTopics: rankedTopics(recentCounts),
  };
}

function rankedTopics(counts) {
  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0], "ja");
    })
    .map(([topic]) => topic)
    .slice(0, 4);
}

function usableTopics(value) {
  return normalizeTopics(value).filter((topic) => !looksLikeLegacySummary(topic));
}

function normalizeTopics(value) {
  const rawItems = Array.isArray(value) ? value : [value];
  return rawItems
    .map((item) => item?.toString().split(/[,\n、]/))
    .flat()
    .map((item) => item?.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function looksLikeLegacySummary(topic) {
  if (!topic) {
    return false;
  }
  return topic.length >= 24 || /[。．！？]/.test(topic);
}

function sharesCoreTopic(left, right) {
  if (!left || !right) {
    return false;
  }
  const leftTokens = tokenizeTopic(left);
  const rightTokens = tokenizeTopic(right);
  return leftTokens.some((token) => rightTokens.includes(token));
}

function tokenizeTopic(value) {
  return value
    .replace(/[「」『』:：]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function collectCommonGround(person, selfProfile) {
  const personItems = uniqueList([
    ...person.hobbies,
    ...person.interests,
    ...person.likes,
    person.hometown,
    person.location,
  ]);
  const selfItems = uniqueList([
    ...selfProfile.hobbies,
    ...selfProfile.interests,
    ...selfProfile.strongTopics,
    ...selfProfile.recentTopics,
    selfProfile.hometown,
    selfProfile.location,
  ]);

  const exactMatches = personItems.filter((item) => selfItems.includes(item));
  if (exactMatches.length) {
    return exactMatches;
  }

  const softMatches = [];
  for (const personItem of personItems) {
    const lowerPersonItem = personItem.toLowerCase();
    const matched = selfItems.find((selfItem) => {
      const lowerSelfItem = selfItem.toLowerCase();
      return lowerSelfItem.includes(lowerPersonItem) || lowerPersonItem.includes(lowerSelfItem);
    });
    if (matched) {
      softMatches.push(personItem);
    }
  }

  return uniqueList(softMatches).slice(0, 3);
}

function pickMatchingWeakTopics(person, selfProfile) {
  return selfProfile.weakTopics.filter((topic) => {
    const low = topic.toLowerCase();
    return [...person.interests, ...person.likes, ...person.hobbies].some((item) => item.toLowerCase().includes(low) || low.includes(item.toLowerCase()));
  });
}

function filterAllowedTopics(items, avoidTopics) {
  return items.filter(Boolean).filter((item) => {
    const lowerItem = item.toLowerCase();
    return !avoidTopics.some((topic) => {
      const lowerTopic = topic.toLowerCase();
      return lowerTopic && (lowerItem.includes(lowerTopic) || lowerTopic.includes(lowerItem));
    });
  });
}

function matchesAny(value, candidates) {
  const lowerValue = value?.toLowerCase() || "";
  return candidates.some((candidate) => {
    const lowerCandidate = candidate?.toLowerCase() || "";
    return lowerCandidate && (lowerValue.includes(lowerCandidate) || lowerCandidate.includes(lowerValue));
  });
}

function hasAnySource(entry, sources) {
  return sources.some((source) => entry.sources.has(source));
}

function uniqueList(items) {
  return items.filter(Boolean).filter((item, index, list) => list.indexOf(item) === index);
}
