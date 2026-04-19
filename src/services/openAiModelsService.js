const DEFAULT_MODEL = "gpt-4.1-mini";

export async function loadOpenAiModels(fallbackModel = DEFAULT_MODEL) {
  try {
    const response = await fetch("/api/models", {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Models endpoint returned ${response.status}`);
    }

    const payload = await response.json();
    const models = Array.isArray(payload.models)
      ? payload.models.map((item) => item?.toString().trim()).filter((item) => item.startsWith("gpt-"))
      : [];

    return uniqueModels(models.length ? models : [fallbackModel]);
  } catch (error) {
    console.warn("Falling back to default OpenAI model list.", error);
    return uniqueModels([fallbackModel]);
  }
}

function uniqueModels(items) {
  return [...new Set(items.filter(Boolean))];
}
