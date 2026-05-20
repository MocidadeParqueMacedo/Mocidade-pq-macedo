// scripts/enviar-lembretes.js
// Roda via GitHub Actions todo dia às 8h
// Lê eventos e auxiliares do Firebase e envia lembretes pelo WhatsApp

const admin = require('firebase-admin');
const axios = require('axios');

// ── Inicializa Firebase Admin ─────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

// ── Helpers ───────────────────────────────────────────────────────────────────
function hoje() {
  const d = new Date();
  // Ajusta para horário de Brasília (UTC-3)
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const y = brt.getFullYear();
  const m = String(brt.getMonth() + 1).padStart(2, '0');
  const day = String(brt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDias(dateStr, dias) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatarData(dateStr) {
  return dateStr.split('-').reverse().join('/');
}

function limparTelefone(tel) {
  const num = tel.replace(/\D/g, '');
  // Garante DDI 55 (Brasil)
  if (num.startsWith('55') && num.length >= 12) return num;
  if (num.length === 11 || num.length === 10) return '55' + num;
  return '55' + num;
}

function montarMensagem(evento, tipo) {
  const dataFmt = formatarData(evento.data || '');
  const local = evento.local ? `\n📍 *Local:* ${evento.local}` : '';
  const horario = evento.horario ? `\n⏰ *Horário:* ${evento.horario}` : '';
  const obs = evento.obs ? `\n📝 ${evento.obs}` : '';

  const prefixos = {
    hoje:    '🔴 *LEMBRETE — HOJE!*',
    amanha:  '🟡 *LEMBRETE — AMANHÃ!*',
    semana:  '🟢 *LEMBRETE — EM 1 SEMANA!*',
  };

  return `${prefixos[tipo]}\n\n📅 *${evento.titulo || 'Evento'}*\n🗓 Data: ${dataFmt}${horario}${local}${obs}\n\n_Reunião de Jovens — Mocidade Parque Macedo_ 🙏`;
}

// ── Envia mensagem via Evolution API ─────────────────────────────────────────
async function enviarWhatsApp(numero, mensagem) {
  const url = `${process.env.EVOLUTION_API_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`;
  try {
    await axios.post(url, {
      number: numero,
      text: mensagem,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.EVOLUTION_API_KEY,
      },
      timeout: 10000,
    });
    return true;
  } catch (e) {
    console.error(`❌ Erro ao enviar para ${numero}:`, e.response?.data || e.message);
    return false;
  }
}

// ── Chave de controle (evita enviar duplicado no mesmo dia) ───────────────────
async function jaEnviou(chave) {
  const snap = await db.ref(`lembretes_enviados/${chave}`).get();
  return snap.exists();
}

async function marcarEnviado(chave) {
  await db.ref(`lembretes_enviados/${chave}`).set({
    enviadoEm: new Date().toISOString(),
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔔 Verificando lembretes —', hoje());

  // Lê dados do Firebase
  const [evSnap, membSnap] = await Promise.all([
    db.ref('app/events').get(),
    db.ref('app/members').get(),
  ]);

  const eventos = evSnap.exists() ? (Array.isArray(evSnap.val()) ? evSnap.val() : Object.values(evSnap.val())) : [];
  const membros = membSnap.exists() ? (Array.isArray(membSnap.val()) ? membSnap.val() : Object.values(membSnap.val())) : [];

  // Filtra auxiliares com telefone
  const auxiliares = membros.filter(m => m && m.auxiliar && m.tel);

  if (!auxiliares.length) {
    console.log('ℹ️ Nenhum auxiliar com telefone cadastrado.');
    process.exit(0);
  }

  console.log(`👥 ${auxiliares.length} auxiliar(es) encontrado(s)`);

  const dataHoje = hoje();
  const dataAmanha = addDias(dataHoje, 1);
  const dataSemana = addDias(dataHoje, 7);

  let totalEnviados = 0;

  for (const ev of eventos) {
    if (!ev || !ev.data) continue;

    let tipo = null;
    if (ev.data === dataHoje)   tipo = 'hoje';
    if (ev.data === dataAmanha) tipo = 'amanha';
    if (ev.data === dataSemana) tipo = 'semana';
    if (!tipo) continue;

    const evId = ev.id || ev.data;
    const chaveBase = `${evId}_${tipo}_${dataHoje}`;

    if (await jaEnviou(chaveBase)) {
      console.log(`⏭️ Já enviado hoje: ${ev.titulo} (${tipo})`);
      continue;
    }

    const mensagem = montarMensagem(ev, tipo);
    console.log(`\n📅 Evento: ${ev.titulo} — ${tipo}`);

    let enviados = 0;
    for (const aux of auxiliares) {
      const numero = limparTelefone(aux.tel);
      console.log(`  📲 Enviando para ${aux.nome} (${numero})...`);
      const ok = await enviarWhatsApp(numero, mensagem);
      if (ok) {
        enviados++;
        console.log(`  ✅ Enviado para ${aux.nome}`);
      }
      // Pequena pausa entre mensagens para não ser bloqueado
      await new Promise(r => setTimeout(r, 1500));
    }

    if (enviados > 0) {
      await marcarEnviado(chaveBase);
      totalEnviados += enviados;
      console.log(`✅ ${enviados}/${auxiliares.length} mensagens enviadas para "${ev.titulo}"`);
    }
  }

  console.log(`\n🏁 Concluído. Total de mensagens enviadas: ${totalEnviados}`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
