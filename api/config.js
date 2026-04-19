module.exports = function handler(_request, response) {
  response.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    openAiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    sharedGeneration: Boolean(process.env.OPENAI_API_KEY),
  });
};
