// scripts/enviar-lembretes.js
// Roda via GitHub Actions todo dia às 8h
// Lê eventos e auxiliares do Firebase e envia lembretes pelo WhatsApp

const admin = require('firebase-admin');
const axios = require('axios');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

function hoje() {
  const d = new Date();
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
    hoje:   '🔴 *LEMBRETE — HOJE!*',
    amanha: '🟡 *LEMBRETE — AMANHÃ!*',
    semana: '🟢 *LEMBRETE — EM 1 SEMANA!*',
  };
  return `${prefixos[tipo]}\n\n📅 *${evento.titulo || 'Evento'}*\n🗓 Data: ${dataFmt}${horario}${local}${obs}\n\n_Reunião de Jovens — Mocidade Parque Macedo_ 🙏`;
}

async function registrarAtividade(descricao) {
  try {
    const snap = await db.ref('app/atividades').get();
    let lista = [];
    if (snap.exists()) {
      const val = snap.val();
      lista = Array.isArray(val) ? val : Object.values(val);
    }
    lista.unshift({
      nome: '🤖 Robô de Lembretes',
      email: 'robo@sistema',
      foto: null,
      descricao,
      quando: new Date().toISOString(),
      isRobo: true,
    });
    if (lista.length > 100) lista.splice(100);
    await db.ref('app/atividades').set(lista);
  } catch(e) {
    console.warn('Erro ao registrar atividade:', e.message);
  }
}

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

async function jaEnviou(chave) {
  const snap = await db.ref(`lembretes_enviados/${chave}`).get();
  return snap.exists();
}

async function marcarEnviado(chave) {
  await db.ref(`lembretes_enviados/${chave}`).set({
    enviadoEm: new Date().toISOString(),
  });
}

async function main() {
  console.log('🔔 Verificando lembretes —', hoje());

  const [evSnap, membSnap] = await Promise.all([
    db.ref('app/events').get(),
    db.ref('app/members').get(),
  ]);

  const eventos = evSnap.exists() ? (Array.isArray(evSnap.val()) ? evSnap.val() : Object.values(evSnap.val())) : [];
  const membros = membSnap.exists() ? (Array.isArray(membSnap.val()) ? membSnap.val() : Object.values(membSnap.val())) : [];

  const auxiliares = membros.filter(m => m && m.auxiliar && m.tel);

  if (!auxiliares.length) {
    console.log('ℹ️ Nenhum auxiliar com telefone cadastrado.');
    process.exit(0);
  }

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
      if (ok) { enviados++; console.log(`  ✅ Enviado para ${aux.nome}`); }
      await new Promise(r => setTimeout(r, 1500));
    }

    if (enviados > 0) {
      await marcarEnviado(chaveBase);
      totalEnviados += enviados;
      const tipoLabel = { hoje:'no dia', amanha:'1 dia antes', semana:'1 semana antes' };
      await registrarAtividade(`enviou lembrete "${ev.titulo || 'Evento'}" (${tipoLabel[tipo]||tipo}) para ${enviados} auxiliar(es)`);
      console.log(`✅ ${enviados}/${auxiliares.length} mensagens enviadas para "${ev.titulo}"`);
    }
  }

  console.log(`\n🏁 Concluído. Total: ${totalEnviados}`);
  if (totalEnviados === 0) {
    await registrarAtividade('verificou eventos — nenhum lembrete pendente hoje');
  } else {
    await registrarAtividade(`concluiu envio — ${totalEnviados} mensagem(ns) enviada(s)`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
