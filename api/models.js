const DEFAULT_MODEL = "gpt-4.1-mini";

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    response.status(200).json({ models: [process.env.OPENAI_MODEL || DEFAULT_MODEL] });
    return;
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      response.status(upstream.status).json({ error: errorText || "Failed to load OpenAI models." });
      return;
    }

    const payload = await upstream.json();
    const models = (payload.data || [])
      .map((item) => item?.id?.toString() || "")
      .filter((id) => id.startsWith("gpt-"))
      .sort((left, right) => left.localeCompare(right));

    response.status(200).json({
      models: models.length ? models : [process.env.OPENAI_MODEL || DEFAULT_MODEL],
    });
  } catch (error) {
    response.status(200).json({ models: [process.env.OPENAI_MODEL || DEFAULT_MODEL] });
  }
};
