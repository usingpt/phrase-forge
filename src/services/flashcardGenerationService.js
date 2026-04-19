export function createFlashcardGenerationService() {
  async function generateDraft({ apiKey, model, nativeLanguage, targetLanguage, type, expression }) {
    if (!apiKey) {
      throw new Error("OpenAI APIキーが設定されていません。");
    }

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["idiom", "phrase"],
        },
        expression: {
          type: "string",
        },
        translation: {
          type: "string",
        },
        meaning: {
          type: "string",
        },
        example: {
          type: "string",
        },
        exampleTranslation: {
          type: "string",
        },
        nuance: {
          type: "string",
        },
        notes: {
          type: "string",
        },
        tags: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      required: ["type", "expression", "translation", "meaning", "example", "exampleTranslation", "nuance", "notes", "tags"],
    };

    const instructions = [
      `You are generating a flashcard for language learners whose native language is ${nativeLanguage} and target language is ${targetLanguage}.`,
      "Return concise, natural study content.",
      "Keep all target-language examples in the target language.",
      "Keep explanations, translations, nuance, and notes in the native language.",
      "If the card type is idiom: fill meaning, example, exampleTranslation, nuance, and tags. Translation may be blank.",
      "If the card type is phrase: fill translation, notes, and tags. Meaning/example/exampleTranslation/nuance may be blank when not needed.",
      "Use 2 to 5 short tags helpful for review.",
      "Do not include markdown.",
    ].join("\n");

    const userPrompt = [
      `Card type: ${type}`,
      `Expression: ${expression}`,
      `Native language: ${nativeLanguage}`,
      `Target language: ${targetLanguage}`,
      "Generate a study card draft.",
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "gpt-4.1-mini",
        instructions,
        input: userPrompt,
        text: {
          format: {
            type: "json_schema",
            name: "flashcard_draft",
            schema,
            strict: true,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API エラー: ${response.status} ${errorText}`);
    }

    const payload = await response.json();
    const content = extractStructuredText(payload);
    if (!content) {
      throw new Error("OpenAIから生成結果を読み取れませんでした。");
    }

    try {
      const parsed = JSON.parse(content);
      return {
        type: parsed.type === "phrase" ? "phrase" : "idiom",
        expression: parsed.expression || expression,
        translation: parsed.translation || "",
        meaning: parsed.meaning || "",
        example: parsed.example || "",
        exampleTranslation: parsed.exampleTranslation || "",
        nuance: parsed.nuance || "",
        notes: parsed.notes || "",
        tags: normalizeTags(parsed.tags),
      };
    } catch (error) {
      console.error("Failed to parse OpenAI response.", error);
      throw new Error("生成結果の解析に失敗しました。");
    }
  }

  return {
    generateDraft,
  };
}

function normalizeTags(value) {
  const rawItems = Array.isArray(value) ? value : [];
  return rawItems
    .map((item) => item?.toString().trim())
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function extractStructuredText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }

  return "";
}
