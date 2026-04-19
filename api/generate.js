const DEFAULT_MODEL = "gpt-4.1-mini";

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "Shared OpenAI generation is not configured." });
    return;
  }

  const { model, nativeLanguage, targetLanguage, type, expression } = request.body || {};
  if (!expression || !type) {
    response.status(400).json({ error: "Expression and type are required." });
    return;
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      type: { type: "string", enum: ["idiom", "phrase"] },
      expression: { type: "string" },
      translation: { type: "string" },
      meaning: { type: "string" },
      example: { type: "string" },
      exampleTranslation: { type: "string" },
      nuance: { type: "string" },
      notes: { type: "string" },
      tags: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["type", "expression", "translation", "meaning", "example", "exampleTranslation", "nuance", "notes", "tags"],
  };

  const instructions = [
    `You are generating a flashcard for language learners whose native language is ${nativeLanguage || "Japanese"} and target language is ${targetLanguage || "English"}.`,
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
    `Native language: ${nativeLanguage || "Japanese"}`,
    `Target language: ${targetLanguage || "English"}`,
    "Generate a study card draft.",
  ].join("\n");

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
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

  const payload = await upstream.text();
  response.status(upstream.status).setHeader("Content-Type", upstream.headers.get("content-type") || "application/json").send(payload);
};
