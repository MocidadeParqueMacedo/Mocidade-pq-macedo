// Notificações diárias do Macedão (eventos, visitas e aniversários).
// Chamada todo dia às 8h (Brasília) pelo pg_cron do próprio Supabase.
// Mesmos textos, tipos e regras do antigo robô do GitHub Actions.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createECDH } from "node:crypto";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function config(chave: string): Promise<string | null> {
  const { data } = await db.from("config_privada").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}

async function ler(path: string): Promise<any> {
  const { data, error } = await db.rpc("kv_get", { p: path });
  if (error) throw error;
  return data;
}

const valores = (v: any): any[] => (!v ? [] : Array.isArray(v) ? v : Object.values(v));

// Data no fuso de Brasília (UTC-3)
function brt(diasAFrente = 0) {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + diasAFrente * 86400 * 1000);
  const ymd = d.toISOString().slice(0, 10);
  return { ymd, md: ymd.slice(5), ano: d.getUTCFullYear() };
}

Deno.serve(async (req) => {
  const token = await config("cron_token");
  if (!token || req.headers.get("x-cron-token") !== token) return new Response("não autorizado", { status: 401 });

  const corpo = await req.json().catch(() => ({}));
  const soVerificar = corpo.modo === "verificar";
  const log: string[] = [];

  // Chave VAPID: a mesma usada pelo app (a pública é derivada da privada)
  const privada = (await config("vapid_private"))!.trim();
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(deB64url(privada));
  const publica = b64url(new Uint8Array(ecdh.getPublicKey()));
  webpush.setVapidDetails("mailto:rdj.parquemacedo@gmail.com", publica, privada);
  log.push("chave publica: " + publica);

  const hoje = brt(0), amanha = brt(1), em7 = brt(7);
  log.push(`hoje ${hoje.ymd} | amanha ${amanha.ymd}`);

  // Aparelhos (sem repetir o mesmo endereço)
  const rd = (await ler("dispositivos")) || {};
  const vistos = new Set<string>();
  const ds: { chave: string; d: any }[] = [];
  for (const [chave, d] of Object.entries<any>(Array.isArray(rd) ? Object.assign({}, rd) : rd)) {
    if (d && d.endpoint && d.p256dh && !vistos.has(d.endpoint)) { vistos.add(d.endpoint); ds.push({ chave, d }); }
  }
  log.push(`${ds.length} dispositivos`);

  // Monta a lista do dia
  const fila: { titulo: string; corpo: string; tag: string }[] = [];
  for (const ev of valores(await ler("app/events"))) {
    if (!ev) continue;
    const tit = ev.titulo || "";
    const hor = ev.horario ? `, às ${ev.horario}` : "";
    if (ev.data === amanha.ymd) fila.push({ titulo: "📅 Evento amanhã!", corpo: `Amanhã vai ocorrer o evento ${tit}${hor}. Esperamos todos vocês, Deus abençoe!`, tag: `ev-${ev.id ?? 0}-1d` });
    else if (ev.data === em7.ymd) fila.push({ titulo: "📅 Evento em 1 semana!", corpo: `Daqui a uma semana vai ocorrer o evento ${tit}${hor}. Esperamos todos vocês, Deus abençoe!`, tag: `ev-${ev.id ?? 0}-7d` });
  }
  for (const v of valores(await ler("app/visitas"))) {
    if (v && v.data === amanha.ymd) fila.push({ titulo: "🏠 Visita amanhã!", corpo: `Amanhã haverá visita na casa de ${v.nome || ""}. Esperamos todos vocês, Deus abençoe!`, tag: `vis-${v.id ?? ""}` });
  }
  for (const m of valores(await ler("app/members"))) {
    if (!m || !m.nascimento) continue;
    const n: string = m.nascimento;
    const p = n.includes("-") ? n.split("-") : n.split("/");
    if (p.length < 3) continue;
    const md = n.includes("-") ? `${p[1]}-${p[2]}` : `${p[1]}-${p[0]}`;
    const ano = parseInt(n.includes("-") ? p[0] : p[2], 10);
    if (isNaN(ano)) continue;
    const nome = String(m.nome || "").trim().split(/\s+/)[0] || "";
    if (md === amanha.md) fila.push({ titulo: "🎉 O dia tão esperado está chegando!", corpo: `Amanhã, ${nome} completa ${amanha.ano - ano} anos. Não se esqueçam de parabenizar!`, tag: `an-${m.id ?? ""}-am` });
    else if (md === hoje.md) fila.push({ titulo: "🎂 A data tão especial chegou!", corpo: `Hoje é aniversário de ${nome}, que está completando ${hoje.ano - ano} anos! Deus abençoe grandemente!`, tag: `an-${m.id ?? ""}-hj` });
  }
  log.push(`${fila.length} notificacoes para hoje: ` + fila.map((f) => f.tag).join(", "));

  if (soVerificar) return Response.json({ ok: true, modo: "verificar", log });

  // Teste técnico: envia para um aparelho inexistente — o servidor do Google deve
  // responder "não encontrado", o que prova que criptografia e assinatura estão certas.
  if (corpo.modo === "testar_envio") {
    const falso = createECDH("prime256v1"); falso.generateKeys();
    try {
      await webpush.sendNotification({
        endpoint: "https://fcm.googleapis.com/fcm/send/teste-aparelho-inexistente",
        keys: { p256dh: b64url(new Uint8Array(falso.getPublicKey())), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) },
      }, JSON.stringify({ title: "teste", body: "teste", tag: "teste" }), { TTL: 60 });
      log.push("resposta inesperada: aceito");
    } catch (e: any) {
      log.push(`resposta do Google: ${e?.statusCode} ${String(e?.body || e?.message || e).slice(0, 120)}`);
    }
    return Response.json({ ok: true, modo: "testar_envio", log });
  }

  const mortos = new Set<string>();
  for (const n of fila) {
    // Trava: cada notificação sai no máximo uma vez por dia
    const { error: dup } = await db.from("notif_enviadas").insert({ tag: n.tag, dia: hoje.ymd });
    if (dup) { log.push(`ja enviada hoje: ${n.tag}`); continue; }
    const payload = JSON.stringify({ title: n.titulo, body: n.corpo, tag: n.tag });
    await Promise.all(ds.map(async ({ d }) => {
      const ua = String(d.ua || "?").slice(0, 30);
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth || "" } }, payload, { TTL: 86400, urgency: "high" });
        log.push(`OK: ${n.titulo} | ${ua}`);
      } catch (e: any) {
        const status = e?.statusCode;
        log.push(`FALHA [${status}] ${ua} :: ${String(e?.body || e?.message || e).slice(0, 150)}`);
        if (status === 404 || status === 410) mortos.add(d.endpoint);
      }
    }));
  }

  // Remove aparelhos cuja inscrição não existe mais
  for (const { chave, d } of ds) {
    if (mortos.has(d.endpoint)) { await db.rpc("kv_remove", { p: `dispositivos/${chave}` }); log.push("removido: " + chave.slice(0, 15)); }
  }
  return Response.json({ ok: true, log });
});
