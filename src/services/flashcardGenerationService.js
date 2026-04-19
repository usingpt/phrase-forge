export function createFlashcardGenerationService() {
  async function generateDraft({ model, nativeLanguage, targetLanguage, type, expression }) {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        nativeLanguage,
        targetLanguage,
        type,
        expression,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const payload = await response.json();
    const content = extractStructuredText(payload);
    if (!content) {
      throw new Error("Could not read the generated result from OpenAI.");
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
      throw new Error("Failed to parse the generated result.");
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
