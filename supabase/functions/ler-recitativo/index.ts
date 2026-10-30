// Lê a foto de um cartão de recitativo com o OCR.space (motor 3, bom em letra
// de mão) e devolve o texto. A chave do OCR.space fica só aqui no servidor.
const CHAVE = Deno.env.get("OCRSPACE_API_KEY")!;
const ORIGEM_PERMITIDA = "https://mocidadeparquemacedo.github.io";

const cors = {
  "Access-Control-Allow-Origin": ORIGEM_PERMITIDA,
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // Só o app pode usar (evita que outros sites gastem a cota gratuita)
  if (req.headers.get("origin") !== ORIGEM_PERMITIDA) return resposta({ erro: "origem não permitida" }, 403);

  const { imagem } = await req.json().catch(() => ({}));
  if (typeof imagem !== "string" || !imagem.startsWith("data:image/")) return resposta({ erro: "imagem inválida" }, 400);
  if (imagem.length > 1_400_000) return resposta({ erro: "imagem grande demais" }, 413);

  const form = new FormData();
  form.append("apikey", CHAVE);
  form.append("OCREngine", "3");
  form.append("language", "auto");
  form.append("scale", "true");
  form.append("detectOrientation", "true");
  form.append("base64Image", imagem);

  try {
    const r = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: form });
    const j = await r.json();
    if (j.IsErroredOnProcessing) return resposta({ erro: String(j.ErrorMessage || "falha no OCR") }, 502);
    const texto = (j.ParsedResults || []).map((p: any) => p.ParsedText || "").join("\n");
    return resposta({ texto });
  } catch (e) {
    return resposta({ erro: "OCR indisponível: " + String(e).slice(0, 120) }, 502);
  }
});
