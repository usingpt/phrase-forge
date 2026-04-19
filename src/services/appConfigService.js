const DEFAULT_MODEL = "gpt-4.1-mini";

export async function loadAppConfig() {
  try {
    const response = await fetch("/api/config", {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Config endpoint returned ${response.status}`);
    }

    const payload = await response.json();
    return normalizeConfig(payload);
  } catch (error) {
    console.warn("Falling back to local-only config.", error);
    return normalizeConfig({});
  }
}

function normalizeConfig(input) {
  return {
    supabaseUrl: input.supabaseUrl || "",
    supabaseAnonKey: input.supabaseAnonKey || "",
    openAiModel: input.openAiModel || DEFAULT_MODEL,
    features: {
      cloudSync: Boolean(input.supabaseUrl && input.supabaseAnonKey),
      sharedGeneration: Boolean(input.sharedGeneration),
    },
  };
}
