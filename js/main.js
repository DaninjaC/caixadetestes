// ==========================================
// ASSINATURA DOS ARQUITETOS DO PROJETO
// ==========================================
console.log(
  "%c🚀 ROTA NINJA - Inteligência em Última Milha",
  "color: #ff8c00; font-size: 20px; font-weight: bold; text-shadow: 1px 1px 2px black;"
);
console.log(
  "%cArquitetado e desenvolvido por Daninjac e sua Ajudante.\n\nCódigo auditado e otimizado para alta concorrência, prevenção de memory leaks e roteamento híbrido com failover seguro.",
  "color: #94a3b8; font-size: 14px; line-height: 1.5;"
);

/* ========================================== */
/* main.js - Variáveis Globais e Utilitários */
/* ========================================== */

// --- CHAVES E CONTROLES DO MOTOR HÍBRIDO ---
const LOCATIONIQ_KEY = 'pk.6f7c89475f4a7ab571ae12b3dc7e48b9';
let usarLocationIQComChave = true; 
let proximaTentativaLocationIQ = 0; // Cooldown inteligente para não bloquear permanentemente por falhas transientes

let planilhaStopsData = []; 
let rotaSpx = []; 
let isRotaManual = false;
let horaInicioExpediente = null;
let historicoParadas = [];
let listaRadares = [];
let radarAtivo = null;
let audioCtx = null;
let wakeLock = null;
let globalKmPadrao = 0;
let globalKmOtimizada = 0;

// Variáveis para relatórios e controles de tempo/deslocamento
let globalTempoOcioso = 0;
let globalTempoMovimento = 0;
let globalKmRealPercorrida = 0;

let vagasCriadas = []; 
let vagaCount = 0;

// --- OTIMIZAÇÃO O(1) PARA BUSCAS NO GPS ---
let indicePlanilhaPorStop = new Map();
let indiceVagasPorId = new Map();

function reconstruirIndices() {
    indicePlanilhaPorStop = new Map(planilhaStopsData.map(p => [p.stop, p]));
    indiceVagasPorId = new Map(vagasCriadas.map(v => [v.marker.spxId, v]));
}

// --- HELPER DE FETCH COM TIMEOUT E CHECAGEM DE STATUS ---
async function fetchComTimeout(url, opts = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...opts, signal: controller.signal });
        if (!res.ok) {
            let err = new Error(`HTTP ${res.status} em ${url}`);
            err.status = res.status;
            throw err;
        }
        return res;
    } finally {
        clearTimeout(timer);
    }
}

// =========================================================================
// MOTOR HÍBRIDO DEFINITIVO: FILA GLOBAL + FAILOVER + FREIO ABS
// =========================================================================
let filaRequisicoesHibridas = Promise.resolve();

// Função pública protegida contra Race Conditions
function requisitarRotaHibrida(coordsArray) {
    const execucao = filaRequisicoesHibridas.then(() => requisitarRotaHibridaInterna(coordsArray));
    // Mesmo se uma falhar, a fila não trava para as próximas chamadas do Hub
    filaRequisicoesHibridas = execucao.catch(() => {});
    return execucao;
}

async function requisitarRotaHibridaInterna(coordsArray) {
    let coordsCompletas = [];
    let maxPontos = 24; 

    for (let i = 0; i < coordsArray.length - 1; i += (maxPontos - 1)) {
        let lote = coordsArray.slice(i, i + maxPontos);
        let strCoords = lote.map(c => `${c[0]},${c[1]}`).join(';');
        let sucessoLote = false;

        // 1. TENTA O LOCATIONIQ PRIMEIRO (Com verificação de Cooldown)
        if (!usarLocationIQComChave && Date.now() > proximaTentativaLocationIQ) {
            usarLocationIQComChave = true; // Tempo de punição acabou, tenta novamente
        }

        if (usarLocationIQComChave) {
            try {
                let urlLocationIQ = `https://us1.locationiq.com/v1/directions/driving/${strCoords}?key=${LOCATIONIQ_KEY}&overview=full&geometries=geojson`;
                let res = await fetchComTimeout(urlLocationIQ, {}, 6000);
                let data = await res.json();
                
                if (data.code === "Ok" && data.routes?.length > 0) {
                    coordsCompletas.push(...data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
                    sucessoLote = true;
                } else if (data.error || data.message) {
                    throw { status: 403, message: "Erro de API ou Cota" };
                }
            } catch (err) {
                usarLocationIQComChave = false;
                if (err.status === 429) {
                    proximaTentativaLocationIQ = Date.now() + 30000; // Rate limit: espera 30s
                    console.warn("[Rota Ninja] LocationIQ Rate Limit (429). Alternando para backup.");
                } else if (err.status === 403 || err.status === 401) {
                    proximaTentativaLocationIQ = Date.now() + 300000; // Cota diária estourada: espera 5 min
                    console.warn("[Rota Ninja] LocationIQ Cota Excedida. Alternando para backup.");
                } else {
                    proximaTentativaLocationIQ = Date.now() + 15000; // Falha de rede genérica: 15s
                    console.warn("[Rota Ninja] LocationIQ inacessível. Alternando para backup.");
                }
            }
        }

        // 2. SE FALHOU (OU EM COOLDOWN), ASSUME O OSRM PÚBLICO
        if (!sucessoLote) {
            try {
                let urlOSRM = `https://router.project-osrm.org/route/v1/driving/${strCoords}?overview=full&geometries=geojson`;
                let resOSRM = await fetchComTimeout(urlOSRM, {}, 8000);
                let dataOSRM = await resOSRM.json();
                
                if (dataOSRM.code === "Ok" && dataOSRM.routes?.length > 0) {
                    coordsCompletas.push(...dataOSRM.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
                }
            } catch (errOSRM) {
                console.warn("[Rota Ninja] Falha no lote OSRM de Backup:", errOSRM);
            }
        }

        // 3. FREIO ABS GLOBAL (Delay de 1 segundo real)
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return coordsCompletas;
}
// =========================================================================

// --- RECUPERAÇÃO DO ESTADO SALVO (AO ABRIR O APP) ---
window.addEventListener('load', function() {
    let estadoStr = localStorage.getItem('spx_ninja_estado');
    if (estadoStr) {
        let estado = JSON.parse(estadoStr);
        if (estado.data === new Date().toDateString()) {
            let btnCont = document.getElementById('btn-continuar');
            if (btnCont) btnCont.style.display = 'block';
        } else {
            localStorage.removeItem('spx_ninja_estado');
        }
    }

    if (!localStorage.getItem('spx_ninja_termos_aceitos')) {
        let barra = document.getElementById('aviso-consentimento');
        if (barra) barra.style.display = 'flex';
    }
});

function aceitarTermosAdSense() {
    localStorage.setItem('spx_ninja_termos_aceitos', 'true');
    let barra = document.getElementById('aviso-consentimento');
    if (barra) barra.style.display = 'none';
}

// --- SALVAMENTO E CARREGAMENTO DE ROTAS (PROTEGIDO CONTRA CORRUPÇÃO DE DATAS E LEAKS) ---
function salvarEstadoRota() {
    if (!rotaSpx || rotaSpx.length === 0) return;
    
    let vagasLimpar = [];
    if (isRotaManual) {
        vagasLimpar = vagasCriadas.map(v => ({
            id: v.marker.spxId,
            lat: v.marker.getLatLng().lat,
            lon: v.marker.getLatLng().lng,
            sugados: v.sugados.map(m => m.spxId)
        }));
    }

    let estado = {
        data: new Date().toDateString(),
        isRotaManual: isRotaManual,
        horaInicioExpediente: horaInicioExpediente,
        idxDestino: (typeof idxDestino !== 'undefined' ? idxDestino : 0),
        globalKmPadrao: globalKmPadrao,
        globalKmOtimizada: globalKmOtimizada,
        globalTempoOcioso: globalTempoOcioso,
        globalTempoMovimento: globalTempoMovimento,
        globalKmRealPercorrida: globalKmRealPercorrida,
        historicoParadas: historicoParadas, // Grava como ISO string automaticamente
        planilha: planilhaStopsData.map(p => ({...p, gpsMarker: null, marker: null})),
        rotaSpx: rotaSpx.map(r => (typeof r === 'object' ? {...r, gpsMarker: null, marker: null} : r)),
        vagas: vagasLimpar
    };
    localStorage.setItem('spx_ninja_estado', JSON.stringify(estado));
}

function continuarRotaSalva() {
    let estadoStr = localStorage.getItem('spx_ninja_estado');
    if (!estadoStr) return;
    
    let estado = JSON.parse(estadoStr);
    
    isRotaManual = estado.isRotaManual;
    horaInicioExpediente = new Date(estado.horaInicioExpediente);
    globalKmPadrao = estado.globalKmPadrao;
    globalKmOtimizada = estado.globalKmOtimizada;
    globalTempoOcioso = estado.globalTempoOcioso || 0;
    globalTempoMovimento = estado.globalTempoMovimento || 0;
    globalKmRealPercorrida = estado.globalKmRealPercorrida || 0;
    
    // CORREÇÃO CRÍTICA: Revivendo as Datas para não gerar NaN
    historicoParadas = (estado.historicoParadas || []).map(h => ({
        ...h,
        hora: new Date(h.hora) 
    }));

    planilhaStopsData = estado.planilha;
    rotaSpx = estado.rotaSpx;

    if (isRotaManual && estado.vagas) {
        vagasCriadas = estado.vagas.map(v => {
            return {
                marker: { 
                    spxId: v.id, 
                    getLatLng: () => ({lat: v.lat, lng: v.lon}),
                    __isRealLeafletMarker: false // ALERTA: Isto é um mock para restauração!
                },
                sugados: v.sugados.map(sId => ({ spxId: sId }))
            };
        });
    }

    // Reconstrói a indexação O(1) do mapa
    reconstruirIndices();
    baixarRadaresDaRegiao(planilhaStopsData);
    
    esconderTodasTelas();
    mostrarTela('tela-navegacao');
    
    // CORREÇÃO: Passando idxDestino de forma limpa, sem usar variável global (window.destinoSalvo)
    if (typeof iniciarInterfaceGPS === "function") {
        iniciarInterfaceGPS(estado.idxDestino);
    }
}

// --- GERENCIAMENTO E TRANSIÇÕES DE TELAS ---
function esconderTodasTelas() {
    const telas = [
        'controles-iniciais', 'modal-escolha-modo', 'modal-auditoria', 
        'modal-info-padrao', 'modal-info-otimizada', 'modal-guia-manual', 'modal-desenho-manual', 
        'modal-guia-doca-manual', 'modal-doca', 'modal-guia-gps', 'tela-navegacao', 
        'modal-menu-stops', 'modal-relatorio'
    ];
    telas.forEach(id => { let el = document.getElementById(id); if(el) el.style.display = 'none'; });
}

function iniciarModoManual() { 
    esconderTodasTelas(); 
    if (localStorage.getItem('spx_ninja_hide_manual_guide') === 'true') {
        avancarParaDesenhoManual(true);
    } else {
        mostrarTela('modal-guia-manual', 'block');
    }
}

function avancarParaDesenhoManual(isSilent = false) {
    if (!isSilent) {
        let chk = document.getElementById('chk-nao-mostrar-manual');
        if (chk && chk.checked) {
            localStorage.setItem('spx_ninja_hide_manual_guide', 'true');
        }
    }
    esconderTodasTelas();
    if (typeof iniciarMapeamentoManual === "function") iniciarMapeamentoManual(); 
    else alert("O motor manual ainda não foi carregado.");
}

function prepararGuiaDocaManual() {
    esconderTodasTelas();
    if (localStorage.getItem('spx_ninja_hide_doca_manual') === 'true') {
        if (typeof finalizarMapeamentoManual === "function") finalizarMapeamentoManual(); 
    } else {
        mostrarTela('modal-guia-doca-manual', 'block');
    }
}

function avancarParaDocaManualReal() {
    let chk = document.getElementById('chk-nao-mostrar-doca-manual');
    if (chk && chk.checked) localStorage.setItem('spx_ninja_hide_doca_manual', 'true');
    if (typeof finalizarMapeamentoManual === "function") finalizarMapeamentoManual();
}

function prepararIdaParaGPS() {
    esconderTodasTelas();
    if (localStorage.getItem('spx_ninja_hide_guide') === 'true') {
        avancarParaMapaReal(true);
    } else {
        mostrarTela('modal-guia-gps', 'block');
    }
}

function avancarParaMapaReal(isSilent = false) {
    if (!isSilent) {
        let chk = document.getElementById('chk-nao-mostrar-gps');
        if (chk && chk.checked) localStorage.setItem('spx_ninja_hide_guide', 'true');
    }
    esconderTodasTelas();
    mostrarTela('tela-navegacao');
    if (typeof iniciarInterfaceGPS === "function") iniciarInterfaceGPS(); // Assume default idx = 0
}

function iniciarModoAutomatico() { 
    esconderTodasTelas(); 
    if (typeof roteirizarModoAutomatico === "function") roteirizarModoAutomatico(); 
    else alert("O motor automático ainda não foi carregado."); 
}

function mostrarTela(id, displayType = 'flex') {
    let el = document.getElementById(id);
    if(el) el.style.display = displayType;
}
function toggleFaq(element) { element.classList.toggle('active'); }
function limparERecarregar() { localStorage.removeItem('spx_ninja_estado'); location.reload(); }

function dist(la1, lo1, la2, lo2) {
    const R = 6371000; const dLat = (la2-la1) * Math.PI/180; const dLon = (lo2-lo1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function getCorVolume(vol) {
    if (vol === 1) return { bg: '#39FF14', color: '#000' };
    if (vol === 2) return { bg: '#FFCC00', color: '#000' };
    if (vol === 3) return { bg: '#FFA500', color: '#000' };
    if (vol === 4) return { bg: '#FF4500', color: '#fff' };
    if (vol >= 5) return { bg: '#FF0000', color: '#fff' };
    return { bg: '#8B0000', color: '#fff' };
}
function extrairRuaPadrao(enderecoBruto) {
    if (!enderecoBruto) return "DESCONHECIDO";
    let limpo = enderecoBruto.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let match = limpo.match(/^([^,0-9-]+)/); if (match) limpo = match[1].trim();
    limpo = limpo.replace(/^R\.\s|^R\s/, "RUA ").replace(/^AV\.\s|^AV\s/, "AVENIDA ");
    const abrevs = {'\\bGEN\\b': 'GENERAL', '\\bMAL\\b': 'MARECHAL', '\\bDR\\b': 'DOUTOR', '\\bPRES\\b': 'PRESIDENTE', '\\bSTO\\b': 'SANTO', '\\bSTA\\b': 'SANTA', '\\bPROF\\b': 'PROFESSOR', '\\bCEL\\b': 'CORONEL', '\\bCAP\\b': 'CAPITAO'};
    for (let p in abrevs) limpo = limpo.replace(new RegExp(p, 'g'), abrevs[p]);
    return limpo.trim();
}

function formatarEnderecos(listaEnderecos, lat, lon) {
    return listaEnderecos.map(end => `<div class="endereco-item">${end.toUpperCase().replace(/(\d+)/g, '<span class="num-box">$1</span>')}</div>`).join('');
}

async function requestWakeLock() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} }
function releaseWakeLock() { if (wakeLock !== null) { wakeLock.release(); wakeLock = null; } }
function initAudio() { try { window.AudioContext = window.AudioContext || window.webkitAudioContext; if (!audioCtx) audioCtx = new AudioContext(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch(e) {} }
function playBipeRadar() { if (!audioCtx) return; try { let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain(); osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'square'; osc.frequency.value = 880; gain.gain.setValueAtTime(0.2, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3); osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.3); } catch(e) {} }

async function baixarRadaresDaRegiao(rota) { 
    if (!rota || rota.length === 0) return; 
    try { 
        let lats = rota.map(p => p.lat), lons = rota.map(p => p.lon); 
        let minLat = Math.min(...lats) - 0.015, maxLat = Math.max(...lats) + 0.015, minLon = Math.min(...lons) - 0.015, maxLon = Math.max(...lons) + 0.015; 
        let query = `[out:json][timeout:15];node["highway"="speed_camera"](${minLat},${minLon},${maxLat},${maxLon});out;`; 
        let res = await fetchComTimeout(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {}, 10000); 
        let data = await res.json(); 
        if (data && data.elements) listaRadares = data.elements.map(e => ({ lat: e.lat, lon: e.lon, speed: e.tags.maxspeed || "" })); 
    } catch(e) {
        console.warn("[Rota Ninja] Falha ao baixar radares da região (Overpass). Radares inativos.", e);
    } 
}

async function enviarContato(event) {
    event.preventDefault(); 
    let seuEmailPessoal = "22415a1827e214478c05b0e774d99d72"; 
    
    let nome = document.getElementById('contato-nome').value;
    let email = document.getElementById('contato-email').value;
    let mensagem = document.getElementById('contato-mensagem').value;
    let btnSubmit = event.target.querySelector('button[type="submit"]');

    let textoOriginal = btnSubmit.innerText;
    btnSubmit.innerText = "⏳ ENVIANDO...";
    btnSubmit.disabled = true;

    try {
        await fetchComTimeout(`https://formsubmit.co/ajax/${seuEmailPessoal}`, {
            method: "POST",
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ Nome: nome, Email_Motorista: email, Mensagem: mensagem, _subject: "Nova Mensagem Rota Ninja!", _captcha: "false" })
        }, 8000);

        btnSubmit.innerText = textoOriginal;
        btnSubmit.disabled = false;
        document.getElementById('form-contato').reset(); 
        event.target.parentElement.parentElement.classList.remove('active'); 
        setTimeout(() => alert(`Obrigado, ${nome}! Sua mensagem foi enviada.`), 150);

    } catch (error) {
        btnSubmit.innerText = textoOriginal;
        btnSubmit.disabled = false;
        setTimeout(() => alert("Ocorreu um erro ao enviar. Verifique sua conexão e tente novamente."), 150);
        console.warn("[Rota Ninja] Erro ao enviar contato:", error);
    }
}
