/* ========================================= */
/* motor-auto.js - Roteirização Automática   */
/* ========================================= */

let rotaOriginalData = [];
let rotaOtimizadaData = [];
let mapPadrao = null, mapOtimizado = null;
let layerPadrao = L.layerGroup(), layerOtimizado = L.layerGroup();

function roteirizarModoAutomatico() {
    isRotaManual = false;
    mostrarTela('loading-msg');
    
    let paradasOficiais = planilhaStopsData.filter(p => !p.extra);
    let pacotesMisteriosos = planilhaStopsData.filter(p => p.extra);

    rotaOriginalData = [...paradasOficiais, ...pacotesMisteriosos];

    rotaOtimizadaData = gerarRotaPorFluxo(paradasOficiais);

    let counterExtra = 1;
    pacotesMisteriosos.forEach(mist => {
        let menorDist = Infinity;
        let melhorIdx = -1;
        
        for (let i = 0; i < rotaOtimizadaData.length; i++) {
            let d = dist(mist.lat, mist.lon, rotaOtimizadaData[i].lat, rotaOtimizadaData[i].lon);
            if (d < menorDist) { menorDist = d; melhorIdx = i; }
        }

        if (melhorIdx !== -1) {
            let objExtra = { ...mist, andaAPe: menorDist <= 70 };
            rotaOtimizadaData.splice(melhorIdx + 1, 0, objExtra);
            counterExtra++;
        }
    });
    
    baixarRadaresDaRegiao(rotaOriginalData);

    esconderTodasTelas();
    mostrarTela('modal-auditoria');
    iniciarMapasAuditoria();
    
    setTimeout(async () => {
        mapPadrao.invalidateSize();
        mapOtimizado.invalidateSize();
        
        let rPadrao = await plotarVisaoPassaro(layerPadrao, mapPadrao, rotaOriginalData, '#ff4444');
        let rOtim = await plotarVisaoPassaro(layerOtimizado, mapOtimizado, rotaOtimizadaData, '#39FF14');
        
        globalKmPadrao = rPadrao.km;
        globalKmOtimizada = rOtim.km;

        document.getElementById('km-padrao').innerHTML = `Custo: <b>${globalKmPadrao.toFixed(2)} km</b><br><span style="font-size:11px; color:#ccc;">(${rPadrao.quebras} manobras | ${rPadrao.revisitadas} zig-zags)</span>`;
        document.getElementById('km-otimizada').innerHTML = `Custo: <b>${globalKmOtimizada.toFixed(2)} km</b><br><span style="font-size:11px; color:#ccc;">(${rOtim.quebras} manobras | ${rOtim.revisitadas} zig-zags)</span>`;
    }, 200);
}

function iniciarMapasAuditoria() {
    if (!mapPadrao) {
        mapPadrao = L.map('mapa-padrao', { zoomControl: false }).setView([-23.61, -46.57], 14);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapPadrao);
        layerPadrao.addTo(mapPadrao);
    }
    if (!mapOtimizado) {
        mapOtimizado = L.map('mapa-otimizado', { zoomControl: false }).setView([-23.61, -46.57], 14);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapOtimizado);
        layerOtimizado.addTo(mapOtimizado);
    }
}

async function plotarVisaoPassaro(camada, mapaLocal, rota, corLinha) {
    camada.clearLayers();
    let boundsCoords = [];
    let distanciaTotalReal = 0;
    
    let quebrasDeRua = 0;
    let ruasVisitadas = new Set();
    let ruasRevisitadasPenalty = 0;

    if (rota.length === 0) return { km: 0, quebras: 0, revisitadas: 0 };
    let latlngs = [];

    for (let i = 0; i < rota.length; i++) {
        let p = rota[i];
        boundsCoords.push([p.lat, p.lon]);
        latlngs.push([p.lat, p.lon]);

        let corPino = p.extra ? '#FF8C00' : ((i === 0) ? '#007AFF' : '#555'); 
        let textoHover = p.extra ? "Extra" : (i === 0 ? "INÍCIO" : "Stop " + p.stop);

        L.circleMarker([p.lat, p.lon], { radius: 5, color: '#fff', fillColor: corPino, fillOpacity: 1, weight: 1 })
            .bindTooltip(textoHover, { permanent: true, direction: 'right', className: 'stop-label', offset: [5, 0] })
            .addTo(camada);

        if (i > 0) {
            const anterior = rota[i-1];
            const dReta = dist(anterior.lat, anterior.lon, p.lat, p.lon);
            
            if (anterior.ruaPadrao !== p.ruaPadrao && anterior.ruaPadrao !== "DESCONHECIDO" && p.ruaPadrao !== "DESCONHECIDO") {
                quebrasDeRua++;
                ruasVisitadas.add(anterior.ruaPadrao);
                
                if (ruasVisitadas.has(p.ruaPadrao)) {
                    ruasRevisitadasPenalty++;
                }
            }

            if (dReta <= 70) {
                distanciaTotalReal += dReta; 
            } else {
                distanciaTotalReal += dReta * 1.8; 
            }
        }
    }

    if (latlngs.length > 0) {
        L.polyline(latlngs, { color: corLinha, weight: 3, opacity: 0.8, dashArray: '6, 6' }).addTo(camada);
        mapaLocal.fitBounds(L.polyline(boundsCoords).getBounds(), { padding: [30, 30] });
    }

    let kmComMulta = (distanciaTotalReal + (quebrasDeRua * 350) + (ruasRevisitadasPenalty * 1000)) / 1000;
    return { km: kmComMulta, quebras: quebrasDeRua, revisitadas: ruasRevisitadasPenalty };
}

function gerarRotaPorFluxo(rotaBase) {
    if (rotaBase.length <= 1) return rotaBase;
    let grupos = [];
    let grupoAtual = [rotaBase[0]];

    for (let i = 1; i < rotaBase.length; i++) {
        let p = rotaBase[i];
        let ant = grupoAtual[grupoAtual.length - 1];

        if (p.ruaPadrao === ant.ruaPadrao && p.ruaPadrao !== "DESCONHECIDO" && dist(p.lat, p.lon, ant.lat, ant.lon) < 800) {
            grupoAtual.push(p);
        } else {
            let adicionou = false;
            for (let g of grupos) {
                if (g[0].ruaPadrao === p.ruaPadrao && g[0].ruaPadrao !== "DESCONHECIDO") {
                    let lastG = g[g.length - 1];
                    if (dist(p.lat, p.lon, lastG.lat, lastG.lon) < 800) {
                        g.push(p); adicionou = true; break;
                    }
                }
            }
            if (!adicionou) { grupos.push(grupoAtual); grupoAtual = [p]; }
        }
    }
    if (grupoAtual.length > 0) grupos.push(grupoAtual);

    grupos.forEach(g => g.sort((a, b) => a.idOriginal - b.idOriginal));

    let blocosPendentes = [...grupos];
    blocosPendentes.sort((a, b) => a[0].idOriginal - b[0].idOriginal);
    let blocoAtual = blocosPendentes.shift();

    let rotaFinal = [...blocoAtual];

    while (blocosPendentes.length > 0) {
        let ultimoPonto = rotaFinal[rotaFinal.length - 1];
        let melhorIdx = 0, minCusto = Infinity;

        for (let i = 0; i < blocosPendentes.length; i++) {
            let candStart = blocosPendentes[i][0];
            let d = dist(ultimoPonto.lat, ultimoPonto.lon, candStart.lat, candStart.lon);
            if (d < minCusto) { minCusto = d; melhorIdx = i; }
        }

        rotaFinal.push(...blocosPendentes[melhorIdx]);
        blocosPendentes.splice(melhorIdx, 1);
    }

    for (let i = 0; i < rotaFinal.length; i++) {
        if (i === 0) { rotaFinal[i].andaAPe = false; continue; }
        rotaFinal[i].andaAPe = dist(rotaFinal[i-1].lat, rotaFinal[i-1].lon, rotaFinal[i].lat, rotaFinal[i].lon) <= 70;
    }
    return rotaFinal;
}

function escolherRotaPadrao() {
    rotaSpx = [...rotaOriginalData];
    esconderTodasTelas();
    mostrarTela('modal-info-padrao');
}

function escolherRotaOtimizada() {
    rotaSpx = [...rotaOtimizadaData];
    esconderTodasTelas();
    mostrarTela('modal-info-otimizada');
}

function avancarParaGPSPadrao() {
    esconderTodasTelas();
    mostrarTela('tela-navegacao');
    if (typeof iniciarInterfaceGPS === "function") iniciarInterfaceGPS();
}

function avancarParaDocaOtimizada() {
    esconderTodasTelas();
    if (typeof renderizarModoDoca === "function") renderizarModoDoca();
    mostrarTela('modal-doca');
}
