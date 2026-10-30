// Glorinha — assistente de IA do app (versão 1: só consulta, não altera nada).
// O Gemini (plano gratuito) só entende o pedido e escreve a resposta; todas as
// contas (faltas, frequência, aniversários...) são feitas aqui, com exatidão,
// sobre os dados do app. Só o mínimo necessário é enviado ao Google: nada de
// telefone, endereço, pai/mãe.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CHAVE = Deno.env.get("GEMINI_API_KEY")!;
const ORIGEM_PERMITIDA = "https://mocidadeparquemacedo.github.io";
// Ordem de preferência; se um estiver lotado/sem cota, tenta o próximo.
const MODELOS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-flash-latest"];
const LIVROS = ["Gênesis","Êxodo","Levítico","Números","Deuteronômio","Josué","Juízes","Rute","1 Samuel","2 Samuel","1 Reis","2 Reis","1 Crônicas","2 Crônicas","Esdras","Neemias","Ester","Jó","Salmos","Provérbios","Eclesiastes","Cantares","Isaías","Jeremias","Lamentações","Ezequiel","Daniel","Oséias","Joel","Amós","Obadias","Jonas","Miquéias","Naum","Habacuque","Sofonias","Ageu","Zacarias","Malaquias","Mateus","Marcos","Lucas","João","Atos","Romanos","1 Coríntios","2 Coríntios","Gálatas","Efésios","Filipenses","Colossenses","1 Tessalonicenses","2 Tessalonicenses","1 Timóteo","2 Timóteo","Tito","Filemom","Hebreus","Tiago","1 Pedro","2 Pedro","1 João","2 João","3 João","Judas","Apocalipse"];
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const DIAS_SEMANA = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": ORIGEM_PERMITIDA,
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

// ── Dados do app ───────────────────────────────────────────────────────────
const lista = (v: any): any[] => (!v ? [] : Array.isArray(v) ? v : Object.values(v)).filter(Boolean);
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
const hojeBRT = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const fmt = (ymd: string) => ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : "";
const cont = (c: any) => (["", "1ª", "2ª", "3ª", "4ª", "5ª"][parseInt(c)] || c) + " Cont.";

async function ler(path: string) {
  const { data } = await db.from("kv").select("value").eq("path", path).maybeSingle();
  return data?.value ?? null;
}

async function carregar() {
  const [mb, mt, ev, vi, vs] = await Promise.all(["app/members", "app/meetings", "app/events", "app/visitas", "app/versinhos"].map(ler));
  const hoje = hojeBRT();
  const membros = lista(mb).map((m: any) => {
    let dia = "", mes = "", ano = 0;
    const n = String(m.nascimento || "");
    if (n.includes("-")) { const p = n.split("-"); ano = +p[0]; mes = p[1]; dia = p[2]; }
    else if (n.includes("/")) { const p = n.split("/"); dia = p[0]; mes = p[1]; ano = +p[2]; }
    return { id: String(m.id), nome: m.nome || "", genero: m.genero === "F" ? "irmã" : "irmão", continuacao: cont(m.continuacao), auxiliar: !!m.auxiliar, dia, mes, ano };
  });
  // Mesma regra do app: reunião conta se não é "agendada" OU se já tem presença lançada.
  const reunioes = lista(mt)
    .filter((r: any) => (!r.isScheduled || lista(r.present).length > 0) && String(r.date).slice(0, 10) <= hoje)
    .map((r: any) => ({ data: String(r.date).slice(0, 10), presentes: new Set(lista(r.present).map(String)) }))
    .sort((a, b) => b.data.localeCompare(a.data));
  return { hoje, membros, reunioes, eventos: lista(ev), visitas: lista(vi), versinhos: lista(vs) };
}

function acharMembros(dados: any, nome: string) {
  const alvo = norm(nome);
  if (!alvo) return [];
  const exatos = dados.membros.filter((m: any) => norm(m.nome) === alvo);
  if (exatos.length) return exatos;
  return dados.membros.filter((m: any) => norm(m.nome).split(" ").some((p: string) => p.startsWith(alvo)) || norm(m.nome).startsWith(alvo));
}
const rotulo = (m: any) => `${m.nome} (${m.genero}, ${m.continuacao})`;

// ── Ferramentas (contas exatas) ────────────────────────────────────────────
const ferramentas: Record<string, (d: any, a: any) => any> = {
  faltas(d, a) {
    const n = Math.max(1, Math.min(20, a.ultimas_reunioes || 3));
    const rs = d.reunioes.slice(0, n);
    const faltaram = d.membros.filter((m: any) => rs.every((r: any) => !r.presentes.has(m.id)));
    return { reunioes_consideradas: rs.map((r: any) => fmt(r.data)), total_que_faltou_em_todas: faltaram.length, nomes: faltaram.map(rotulo) };
  },
  frequencia(d, a) {
    const achados = acharMembros(d, a.nome);
    if (!achados.length) return { erro: "Nenhum membro encontrado com esse nome." };
    if (achados.length > 1) return { varios_membros_com_esse_nome: achados.map(rotulo), dica: "pergunte qual deles" };
    const m = achados[0];
    const total = d.reunioes.length;
    const pres = d.reunioes.filter((r: any) => r.presentes.has(m.id));
    let seguidas = 0;
    for (const r of d.reunioes) { if (r.presentes.has(m.id)) break; seguidas++; }
    return { membro: rotulo(m), presencas: pres.length, reunioes_realizadas: total, porcentagem: total ? Math.round((pres.length / total) * 100) + "%" : "—", ultima_presenca: pres[0] ? fmt(pres[0].data) : "nunca", faltas_seguidas_ate_hoje: seguidas };
  },
  ranking_frequencia(d, a) {
    const total = d.reunioes.length;
    const lim = Math.max(1, Math.min(30, a.quantidade || 10));
    const arr = d.membros.map((m: any) => ({ m, p: d.reunioes.filter((r: any) => r.presentes.has(m.id)).length }));
    arr.sort((x: any, y: any) => a.ordem === "menos" ? x.p - y.p : y.p - x.p);
    return { reunioes_realizadas: total, ordem: a.ordem === "menos" ? "menos presentes primeiro" : "mais presentes primeiro", lista: arr.slice(0, lim).map((x: any) => `${rotulo(x.m)}: ${x.p} de ${total}`) };
  },
  aniversarios(d, a) {
    // Visitante (sem login) só vê os próximos 7 dias, sem idade — igual ao aviso da tela inicial
    if (d.perfil === "anonimo") a = { proximos_dias: Math.min(7, a.proximos_dias || 7) };
    const hoje = new Date(d.hoje + "T12:00:00Z");
    let alvo = d.membros.filter((m: any) => m.dia && m.mes);
    if (a.mes) alvo = alvo.filter((m: any) => +m.mes === +a.mes);
    const prox = alvo.map((m: any) => {
      let dt = new Date(Date.UTC(hoje.getUTCFullYear(), +m.mes - 1, +m.dia, 12));
      if (!a.mes && dt < hoje && dt.toISOString().slice(0, 10) !== d.hoje) dt = new Date(Date.UTC(hoje.getUTCFullYear() + 1, +m.mes - 1, +m.dia, 12));
      const dias = Math.round((dt.getTime() - hoje.getTime()) / 86400000);
      return { m, dt, dias, idade: m.ano ? dt.getUTCFullYear() - m.ano : null };
    }).filter((x: any) => a.mes ? true : x.dias >= 0 && x.dias <= (a.proximos_dias || 30))
      .sort((x: any, y: any) => x.dt - y.dt);
    return { filtro: a.mes ? `mês de ${MESES[+a.mes - 1]}` : `próximos ${a.proximos_dias || 30} dias`, aniversariantes: prox.map((x: any) => `${rotulo(x.m)} — ${x.m.dia}/${x.m.mes}${x.idade && d.perfil !== "anonimo" ? `, completa ${x.idade} anos` : ""}${x.dias === 0 ? " (HOJE)" : ""}`) };
  },
  agenda(d, a) {
    const dias = Math.max(1, Math.min(365, a.proximos_dias || 30));
    const fim = new Date(new Date(d.hoje + "T12:00:00Z").getTime() + dias * 86400000).toISOString().slice(0, 10);
    const dentro = (x: string) => x && x >= d.hoje && x <= fim;
    // Evento privado: só Admin e Usuário (igual ao app); visitas: só quem tem login
    const ev = d.eventos.filter((e: any) => dentro(e.data) && (!e.privado || d.perfil === "admin" || d.perfil === "usuario")).sort((x: any, y: any) => x.data.localeCompare(y.data))
      .map((e: any) => `${fmt(e.data)}${e.horario ? " às " + e.horario : ""} — ${e.titulo || "Evento"}${e.local ? " (" + e.local + ")" : ""}`);
    const vi = d.perfil === "anonimo" ? [] : d.visitas.filter((v: any) => dentro(v.data)).sort((x: any, y: any) => x.data.localeCompare(y.data))
      .map((v: any) => `${fmt(v.data)} — visita na casa de ${v.nome || "?"}`);
    return { periodo: `de ${fmt(d.hoje)} a ${fmt(fim)}`, eventos: ev, visitas: vi };
  },
  reuniao(d, a) {
    const r = a.data ? d.reunioes.find((x: any) => x.data === a.data) : d.reunioes[0];
    if (!r) return { erro: a.data ? `Não há reunião realizada em ${fmt(a.data)}.` : "Nenhuma reunião realizada." };
    const presentes = d.membros.filter((m: any) => r.presentes.has(m.id)).map((m: any) => m.nome);
    const recit = d.versinhos.filter((v: any) => v.data === r.data).flatMap((v: any) =>
      lista(v.ordem).map((o: any, i: number) => `${i + 1}. ${o.membroNome || "?"} — ${o.ref || (LIVROS[v.livroIdx] || "") + " " + (v.capsTexto || "")}`));
    return { data: fmt(r.data), total_presentes: presentes.length, presentes, recitativos: recit };
  },
  membros(d, a) {
    let m = d.membros;
    if (a.genero) m = m.filter((x: any) => x.genero === (a.genero === "F" ? "irmã" : "irmão"));
    if (a.continuacao) m = m.filter((x: any) => x.continuacao.startsWith(String(a.continuacao)));
    if (a.somente_auxiliares) m = m.filter((x: any) => x.auxiliar);
    return { total: m.length, nomes: m.map(rotulo) };
  },
};

const declaracoes = [
  { name: "faltas", description: "Quem faltou em TODAS as últimas N reuniões realizadas.", parameters: { type: "object", properties: { ultimas_reunioes: { type: "integer", description: "quantas reuniões (padrão 3)" } } } },
  { name: "frequencia", description: "Frequência de um membro: presenças, porcentagem, última presença, faltas seguidas.", parameters: { type: "object", properties: { nome: { type: "string" } }, required: ["nome"] } },
  { name: "ranking_frequencia", description: "Ranking de presença dos membros.", parameters: { type: "object", properties: { ordem: { type: "string", enum: ["mais", "menos"] }, quantidade: { type: "integer" } } } },
  { name: "aniversarios", description: "Aniversariantes de um mês (1-12) ou dos próximos dias.", parameters: { type: "object", properties: { mes: { type: "integer" }, proximos_dias: { type: "integer" } } } },
  { name: "agenda", description: "Eventos e visitas marcados a partir de hoje.", parameters: { type: "object", properties: { proximos_dias: { type: "integer", description: "padrão 30" } } } },
  { name: "reuniao", description: "Resumo de uma reunião realizada: presentes e recitativos. Sem data = a mais recente.", parameters: { type: "object", properties: { data: { type: "string", description: "AAAA-MM-DD" } } } },
  { name: "membros", description: "Lista membros, com filtros opcionais.", parameters: { type: "object", properties: { genero: { type: "string", enum: ["M", "F"] }, continuacao: { type: "integer", description: "1 a 5" }, somente_auxiliares: { type: "boolean" } } } },
];

// ── Conversa com o Gemini ──────────────────────────────────────────────────
async function gemini(modelo: string, corpo: unknown) {
  // Modelo gratuito às vezes trava sem responder: desiste em 25s e tenta o próximo
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": CHAVE, "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(25000),
    });
    return await r.json();
  } catch (e) {
    return { error: { message: "sem resposta: " + String(e).slice(0, 80) } };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.headers.get("origin") !== ORIGEM_PERMITIDA) return resposta({ erro: "origem não permitida" }, 403);

  const { mensagens, usuario, audio, soTranscrever, perfil: perfilPedido } = await req.json().catch(() => ({}));
  // Perfil de quem está usando (o mesmo que o app usa pra liberar as telas)
  const perfil: string = ["anonimo", "usuario", "editor", "admin"].includes(String(perfilPedido)) ? String(perfilPedido) : "anonimo";
  if (!Array.isArray(mensagens)) return resposta({ erro: "sem mensagem" }, 400);

  // Pergunta por áudio (quando o aparelho não transcreve sozinho): o Gemini
  // transcreve primeiro, e a transcrição vira a pergunta normal.
  let transcricao = "";
  if (audio && typeof audio.dados === "string" && typeof audio.mime === "string") {
    if (audio.dados.length > 3_000_000) return resposta({ erro: "áudio longo demais" }, 413);
    for (const modelo of MODELOS) {
      const j = await gemini(modelo, { contents: [{ role: "user", parts: [
        { inline_data: { mime_type: audio.mime, data: audio.dados } },
        { text: "Transcreva exatamente o que foi falado neste áudio, em português do Brasil. Responda só com a transcrição, sem comentários. Se não houver fala, responda apenas: (silêncio)" },
      ] }] });
      if (j.error) continue;
      transcricao = (j.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
      break;
    }
    if (!transcricao) return resposta({ resposta: "Não consegui ouvir direitinho agora 😅 Tenta falar de novo daqui a pouquinho, ou escreve pra mim.", ocupada: true });
    if (/^\(?sil[eê]ncio\)?$/i.test(transcricao)) return resposta({ transcricao: "", resposta: "Não ouvi nada 🙉 Toca no microfone e fala mais pertinho, tá bom?" });
    if (soTranscrever) return resposta({ transcricao });
    mensagens.push({ role: "user", text: transcricao });
  }
  if (!mensagens.length) return resposta({ erro: "sem mensagem" }, 400);

  const dados: any = await carregar();
  dados.perfil = perfil;
  const permitidas = perfil === "anonimo" ? ["agenda", "aniversarios"] : declaracoes.map((x) => x.name);
  const declaracoesPerfil = declaracoes.filter((x) => permitidas.includes(x.name));
  const hoje = new Date(dados.hoje + "T12:00:00Z");
  const sistema = { parts: [{ text:
    `Você é a Glorinha, a assistente virtual do app da Reunião de Jovens da Mocidade Parque Macedo (Congregação Cristã no Brasil). ` +
    `Seu nome é Glorinha: quando perguntarem quem você é, diga que é a Glorinha. ` +
    `Fale em português do Brasil, de forma carinhosa, respeitosa e breve (use emojis com moderação). ` +
    `Hoje é ${DIAS_SEMANA[hoje.getUTCDay()]}, ${fmt(dados.hoje)}.` + (usuario ? ` Você está falando com ${usuario}.` : "") + ` ` +
    `Use SEMPRE as ferramentas para qualquer dado (membros, presenças, reuniões, aniversários, eventos, visitas, recitativos) e repasse os números e nomes exatamente como vierem — nunca invente nem recalcule. ` +
    `Se houver vários membros com o mesmo nome, pergunte qual. ` +
    `A pessoa está usando o app como: ${({ anonimo: "visitante sem login (só vê agenda pública, recitativos e próximos aniversários; para o resto precisa entrar na conta)", usuario: "Usuário", editor: "Editor", admin: "Administrador" } as any)[perfil]}. Nunca revele dados que esse perfil não pode ver. ` +
    `Você aqui só CONSULTA dados. Criar, editar, lançar e apagar são feitos pelos comandos da Glorinha no próprio app: se a pessoa pedir algo assim e você foi chamada, sugira a frase exata que ela pode mandar, por exemplo: "cria evento dia 15/11 às 19h: Ensaio geral na CCB", "marca visita na casa da Eliane sábado às 20h", "lançar presença de domingo", "nova ata", "cadastra membro João da 2ª cont", "lançar recitativo das irmãs 4ª cont", "aprovar Maria como editor". ` +
    `Assuntos fora do app: responda brevemente e com respeito, sem opinar sobre doutrina.` }] };

  const contents: any[] = mensagens.slice(-12).map((m: any) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: String(m.text || "").slice(0, 2000) }] }));
  let iModelo = 0;
  let cotaDiariaEsgotada = true; // vira false se algum modelo falhar por outro motivo
  for (let passo = 0; passo < 8; passo++) {
    const j = await gemini(MODELOS[iModelo], { systemInstruction: sistema, contents, tools: [{ functionDeclarations: declaracoesPerfil }] });
    if (j.error) {
      if (!/PerDay|per day/i.test(JSON.stringify(j.error))) cotaDiariaEsgotada = false;
      // Lotado, sem cota ou indisponível: tenta o próximo modelo, no mesmo passo
      if (iModelo < MODELOS.length - 1) { iModelo++; passo--; continue; }
      return resposta({
        resposta: cotaDiariaEsgotada
          ? "Hoje eu já conversei bastante e chegou no meu limite do dia 😴 Amanhã eu volto, tá bom? Até lá, as informações estão nas telas do app."
          : "Estou com muita gente falando comigo agora 😅 Tenta de novo daqui a 1 minutinho, tá bom?",
        ocupada: true, transcricao,
      });
    }
    const parts = j.candidates?.[0]?.content?.parts || [];
    contents.push({ role: "model", parts });
    const chamadas = parts.filter((p: any) => p.functionCall);
    if (!chamadas.length) {
      const texto = parts.map((p: any) => p.text || "").join("").trim();
      return resposta({ resposta: texto || "Hmm, não consegui pensar numa resposta agora. Pode perguntar de outro jeito?", modelo: MODELOS[iModelo], transcricao });
    }
    contents.push({ role: "user", parts: chamadas.map((c: any) => {
      const f = permitidas.includes(c.functionCall.name) ? ferramentas[c.functionCall.name] : null;
      let resultado: unknown;
      try { resultado = f ? f(dados, c.functionCall.args || {}) : { erro: "ferramenta desconhecida" }; }
      catch (e) { resultado = { erro: String(e).slice(0, 120) }; }
      return { functionResponse: { name: c.functionCall.name, response: { resultado } } };
    }) });
  }
  return resposta({ resposta: "Me perdi um pouquinho aqui 😅 Pode perguntar de novo, de um jeito mais simples?" });
});
