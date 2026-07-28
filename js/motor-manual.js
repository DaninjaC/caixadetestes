/* ========================================= */
/* motor-manual.js - Roteirização por Toque  */
/* ========================================= */

let marcadoresDesenho = [];
let sequenciaSelecionada = []; 
let historicoDeRoteamento = [[]]; 

let mapDesenho;
let linhaDedoDesenho, rotaRealDesenho;
let camadaPinosManual = L.layerGroup(); 
let modoDesenho = false, desenhando = false;
let startX = 0, startY = 0, mudouDeLugar = false, houveCapturaNesteCiclo = false;

function iniciarMapeamentoManual() {
    isRotaManual = true; 
    esconderTodasTelas();
    mostrarTela('modal-desenho-manual');
    montarMapaDesenho();
    baixarRadaresDaRegiao(planilhaStopsData);
}

function montarMapaDesenho() {
    if (!mapDesenho) {
        mapDesenho = L.map('mapa-desenho', { zoomControl: false }).setView([-23.615, -46.575], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapDesenho);
        linhaDedoDesenho = L.polyline([], { color: '#FFCC00', weight: 4, opacity: 0.8, dashArray: '10, 10' }).addTo(mapDesenho);
        rotaRealDesenho = L.polyline([], { color: '#007AFF', weight: 5, opacity: 0.9 }).addTo(mapDesenho);
    }

    camadaPinosManual.addTo(mapDesenho);
    camadaPinosManual.clearLayers();

    marcadoresDesenho = []; sequenciaSelecionada = []; historicoDeRoteamento = [[]]; 
    
    vagasCriadas = []; 
    vagaCount = 0;

    let bounds = [];
    planilhaStopsData.forEach(p => {
        let cor = p.extra ? '#FF8C00' : '#555';
        let marker = L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', fillColor: cor, fillOpacity: 1, weight: 2 })
            .bindTooltip(p.stop, { permanent: true, direction: 'top', className: 'stop-label', offset: [0, -5] })
            .addTo(camadaPinosManual); 
        
        marker.spxId = p.stop; marker.spxLatLng = L.latLng(p.lat, p.lon);
        marker.corOriginal = cor; marker.isGrouped = false;
        marcadoresDesenho.push(marker); bounds.push([p.lat, p.lon]);
    });

    mapDesenho.fitBounds(bounds, { padding: [30, 30] });
    vincularEventosVidro();
}

function toggleModoDesenho() {
    const btn = document.getElementById('btn-toggle-vidro');
    modoDesenho = !modoDesenho;
    if (modoDesenho) {
        btn.innerHTML = "❌ PARAR DESENHO"; btn.style.background = "#dc3545"; btn.style.color = "#fff";
        document.getElementById('camada-desenho').style.display = 'block';
    } else {
        btn.innerHTML = "✏️ ATIVAR DESENHO"; btn.style.background = "#FF8C00"; btn.style.color = "#000";
        document.getElementById('camada-desenho').style.display = 'none';
    }
}

function vincularEventosVidro() {
    const vidro = document.getElementById('camada-desenho');
    
    vidro.addEventListener('pointerdown', function(e) {
        desenhando = true; mudouDeLugar = false; houveCapturaNesteCiclo = false;
        startX = e.clientX; startY = e.clientY;
        let latlng = mapDesenho.containerPointToLatLng([e.clientX - vidro.getBoundingClientRect().left, e.clientY - vidro.getBoundingClientRect().top]);
        linhaDedoDesenho.setLatLngs([latlng]);
        verificarCapturaManual(latlng);
    });

    vidro.addEventListener('pointermove', function(e) {
        if (!desenhando) return;
        if (Math.sqrt((e.clientX - startX)**2 + (e.clientY - startY)**2) > 8) mudouDeLugar = true;
        let latlng = mapDesenho.containerPointToLatLng([e.clientX - vidro.getBoundingClientRect().left, e.clientY - vidro.getBoundingClientRect().top]);
        linhaDedoDesenho.addLatLng(latlng);
        verificarCapturaManual(latlng);
    });

    vidro.addEventListener('pointerup', function(e) {
        if (!desenhando) return;
        desenhando = false; linhaDedoDesenho.setLatLngs([]);
        let latlng = mapDesenho.containerPointToLatLng([e.clientX - vidro.getBoundingClientRect().left, e.clientY - vidro.getBoundingClientRect().top]);

        if (!mudouDeLugar && !houveCapturaNesteCiclo) {
            if (confirm(`Deseja criar a "Vaga ${vagaCount + 1}" neste local da rua?`)) {
                encaixarVagaNoAsfalto(latlng); return;
            }
        }
        let ult = historicoDeRoteamento[historicoDeRoteamento.length - 1];
        if (sequenciaSelecionada.length > ult.length) historicoDeRoteamento.push([...sequenciaSelecionada]);
        atualizarTratamentoAsfaltoManual();
    });
}

function verificarCapturaManual(latlng) {
    marcadoresDesenho.forEach(m => {
        if (!sequenciaSelecionada.includes(m.spxId) && !m.isGrouped) {
            if (mapDesenho.distance(latlng, m.spxLatLng) < 12) {
                sequenciaSelecionada.push(m.spxId);
                m.setStyle({ fillColor: '#39FF14', color: '#000', weight: 3 });
                houveCapturaNesteCiclo = true;
                document.getElementById('ordem-selecionada-desenho').innerHTML = txtOrdemLegenda();
                /* CORREÇÃO: Auto-scroll para a direita */
                document.getElementById('ordem-selecionada-desenho').scrollLeft = 99999;
            }
        }
    });
}

function encaixarVagaNoAsfalto(latlng) {
    document.getElementById('status-texto-desenho').innerText = "⏳ Magnetizando vaga na rua...";
    fetch(`https://router.project-osrm.org/nearest/v1/driving/${latlng.lng},${latlng.lat}`)
        .then(r => r.json()).then(data => {
            let rLatLng = latlng;
            if (data.code === 'Ok' && data.waypoints?.length > 0) {
                let loc = data.waypoints[0].location; rLatLng = L.latLng(loc[1], loc[0]);
            }
            vagaCount++;
            let vId = "Vaga " + vagaCount;
            let marker = L.circleMarker(rLatLng, { radius: 10, color: '#fff', fillColor: '#007AFF', fillOpacity: 1, weight: 3 })
                .bindTooltip(vId, { permanent: true, direction: 'top', className: 'vaga-label', offset: [0, -5] })
                .addTo(camadaPinosManual); 
            
            marker.spxId = vId; marker.spxLatLng = rLatLng; marker.corOriginal = '#007AFF'; marker.isGrouped = false;
            marcadoresDesenho.push(marker);

            let objVaga = { marker: marker, conectoras: [], sugados: [] };
            marcadoresDesenho.forEach(m => {
                if (m !== marker && !m.isGrouped && !sequenciaSelecionada.includes(m.spxId) && !m.spxId.startsWith("Vaga")) {
                    if (mapDesenho.distance(rLatLng, m.spxLatLng) <= 70) {
                        m.isGrouped = true;
                        m.setStyle({ fillColor: '#007AFF', color: '#333', weight: 1, dashArray: '2,2' });
                        let cordinha = L.polyline([rLatLng, m.spxLatLng], { color: '#007AFF', weight: 2, dashArray: '4,4', opacity: 0.6 }).addTo(mapDesenho);
                        objVaga.conectoras.push(cordinha); objVaga.sugados.push(m);
                    }
                }
            });
            vagasCriadas.push(objVaga);
            document.getElementById('btn-undo-vaga').style.display = 'inline-block';
            document.getElementById('status-texto-desenho').innerText = `✅ ${vId} fixada!`;
            document.getElementById('ordem-selecionada-desenho').innerHTML = txtOrdemLegenda();
            /* CORREÇÃO: Auto-scroll para a direita */
            document.getElementById('ordem-selecionada-desenho').scrollLeft = 99999;
            atualizarTratamentoAsfaltoManual();
        });
}

function txtOrdemLegenda() {
    if (sequenciaSelecionada.length === 0) return "Nenhuma parada selecionada.";
    return sequenciaSelecionada.map(id => {
        if (id.startsWith("Vaga")) {
            let v = vagasCriadas.find(x => x.marker.spxId === id);
            if (v && v.sugados.length > 0) return `${id} (${v.sugados.map(m=>m.spxId).join(", ")})`;
        }
        return id;
    }).join(" ➔ ");
}

function desfazerUltimoRisco() {
    if (historicoDeRoteamento.length > 1) {
        historicoDeRoteamento.pop();
        sequenciaSelecionada = [...historicoDeRoteamento[historicoDeRoteamento.length - 1]];
        marcadoresDesenho.forEach(m => { if(!m.isGrouped) m.setStyle({ fillColor: m.corOriginal, color: '#fff', weight: 2 }); });
        marcadoresDesenho.forEach(m => { if(sequenciaSelecionada.includes(m.spxId)) m.setStyle({ fillColor: '#39FF14', color: '#000', weight: 3 }); });
        document.getElementById('ordem-selecionada-desenho').innerHTML = txtOrdemLegenda();
        document.getElementById('ordem-selecionada-desenho').scrollLeft = 99999;
        atualizarTratamentoAsfaltoManual();
    }
}

function desfazerUltimaVaga() {
    if (vagasCriadas.length > 0) {
        let v = vagasCriadas.pop();
        camadaPinosManual.removeLayer(v.marker);
        marcadoresDesenho = marcadoresDesenho.filter(m => m !== v.marker);
        sequenciaSelecionada = sequenciaSelecionada.filter(id => id !== v.marker.spxId);
        v.conectoras.forEach(l => mapDesenho.removeLayer(l));
        v.sugados.forEach(m => { m.isGrouped = false; m.setStyle({ fillColor: m.corOriginal, color: '#fff', weight: 2, dashArray: '' }); });
        vagaCount--;
        if (vagasCriadas.length === 0) document.getElementById('btn-undo-vaga').style.display = 'none';
        document.getElementById('ordem-selecionada-desenho').innerHTML = txtOrdemLegenda();
        document.getElementById('ordem-selecionada-desenho').scrollLeft = 99999;
        atualizarTratamentoAsfaltoManual();
    }
}

async function atualizarTratamentoAsfaltoManual() {
    if (sequenciaSelecionada.length <= 1) { rotaRealDesenho.setLatLngs([]); return; }
    try {
        let urlCoords = sequenciaSelecionada.map(id => {
            let m = marcadoresDesenho.find(x => x.spxId === id); return m.spxLatLng.lng + ',' + m.spxLatLng.lat;
        }).join(';');
        let res = await fetch(`https://router.project-osrm.org/route/v1/driving/${urlCoords}?overview=full&geometries=geojson`);
        let data = await res.json();
        if (data.routes?.length > 0) rotaRealDesenho.setLatLngs(data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
    } catch(e){}
}

function finalizarMapeamentoManual() {
    if (sequenciaSelecionada.length === 0) { alert("Selecione ao menos 1 parada no desenho!"); return; }
    if (modoDesenho) toggleModoDesenho();
    
    rotaSpx = [...sequenciaSelecionada]; 

    esconderTodasTelas();
    if (typeof renderizarModoDoca === "function") renderizarModoDoca();
    mostrarTela('modal-doca');
}
