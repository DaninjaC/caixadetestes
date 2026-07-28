/* ========================================= */
/* motor-gps.js - Navegação de Rua Avançada  */
/* ========================================= */

let mapGps;
let trilhaMestreGps, rotaRealGps, proximaPernaGps;
let markerUserGps, markerDestGps;
let camadaFundoGps = L.layerGroup();

let idRastreadorGps = null;

let idxDestino = 0, idxPasso = 0;
let minhaLat, minhaLon, ultimaLatReq, ultimaLonReq;
let passosNavegacao = [], distAnteriorCurva = Infinity;
let latAntGps = null, lonAntGps = null, headingCarro = null;
let aguardandoConfirmacao = false;

// NOVA VARIÁVEL: Cronômetro de tempo de volante
let ultimaHoraMovimento = null;

function getAlvoData(index) {
    if (isRotaManual) {
        let idAlvo = rotaSpx[index];
        if (idAlvo.startsWith("Vaga")) {
            let v = vagasCriadas.find(x => x.marker.spxId === idAlvo);
            let pacotes = v.sugados.map(m => planilhaStopsData.find(p => p.stop === m.spxId));
            return {
                id: idAlvo, isVaga: true, lat: v.marker.getLatLng().lat, lon: v.marker.getLatLng().lng,
                pacotes: pacotes, totalVol: pacotes.reduce((a, b) => a + b.pacotes, 0),
                comercial: pacotes.some(p => p.comercial),
                markerStyle: { radius: 10, color: '#fff', fillColor: '#007AFF', weight: 2 },
                status: pacotes[0].status 
            };
        } else {
            let p = planilhaStopsData.find(x => x.stop === idAlvo);
            return { 
                id: idAlvo, isVaga: false, lat: p.lat, lon: p.lon, 
                pacotes: [p], totalVol: p.pacotes, comercial: p.comercial, obj: p,
                markerStyle: { radius: 7, color: '#666', fillColor: p.extra ? '#FF8C00' : '#333', weight: 1 },
                status: p.status
            };
        }
    } else {
        let p = rotaSpx[index];
        return { 
            id: p.stop, isVaga: false, lat: p.lat, lon: p.lon, 
            pacotes: [p], totalVol: p.pacotes, comercial: p.comercial, obj: p,
            markerStyle: { radius: 7, color: '#666', fillColor: p.extra ? '#FF8C00' : '#333', weight: 1 },
            status: p.status
        };
    }
}

function iniciarInterfaceGPS() {
    initAudio(); requestWakeLock();
    
    if (!horaInicioExpediente) horaInicioExpediente = new Date();
    
    // Inicia o cronômetro de movimento assim que abre o GPS
    ultimaHoraMovimento = new Date();

    if (!mapGps) {
        mapGps = L.map('mapa-gps', { zoomControl: false, attributionControl: false }).setView([-23.615, -46.575], 18);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapGps);
        camadaFundoGps.addTo(mapGps);
        
        trilhaMestreGps = L.polyline([], { color: '#000000', weight: 4, opacity: 0.6, dashArray: '6, 6' }).addTo(mapGps);
        proximaPernaGps = L.polyline([], { color: '#9d00ff', weight: 6, opacity: 0.9 }).addTo(mapGps);
        rotaRealGps = L.polyline([], { color: '#007AFF', weight: 6, opacity: 0.9 }).addTo(mapGps);
    }

    camadaFundoGps.clearLayers();
    
    for (let i = 0; i < rotaSpx.length; i++) {
        let alvo = getAlvoData(i);
        let fillColor = alvo.status === 'concluido' ? '#888' : (alvo.status === 'pendente' ? '#ff0000' : alvo.markerStyle.fillColor);

        let marker = L.circleMarker([alvo.lat, alvo.lon], { 
            radius: alvo.markerStyle.radius, color: alvo.markerStyle.color, 
            fillColor: fillColor, fillOpacity: 1, weight: alvo.markerStyle.weight 
        }).bindTooltip(alvo.isVaga ? alvo.id : (alvo.obj.extra ? "Extra" : "Stop " + alvo.id), { permanent: true, direction: 'top', className: 'stop-label' }).addTo(camadaFundoGps);

        if(isRotaManual) {
            if (alvo.isVaga) vagasCriadas.find(x => x.marker.spxId === alvo.id).gpsMarker = marker;
            else planilhaStopsData.find(x => x.stop === alvo.id).gpsMarker = marker;
            
            if (alvo.isVaga) {
                let v = vagasCriadas.find(x => x.marker.spxId === alvo.id);
                if(v.sugados) v.sugados.forEach(m => {
                    let pData = planilhaStopsData.find(x => x.stop === m.spxId);
                    let mLat = pData ? [pData.lat, pData.lon] : (m.getLatLng ? m.getLatLng() : [0,0]);
                    L.circleMarker(mLat, { radius: 5, color: '#007AFF', fillColor: '#111', fillOpacity: 0.6, weight: 1, dashArray: '2,2' }).addTo(camadaFundoGps);
                });
            }
        } else {
            rotaSpx[i].gpsMarker = marker;
        }
    }

    idxDestino = typeof window.destinoSalvo !== 'undefined' ? window.destinoSalvo : 0;
    
    desenharTrilhaMestreFixaCompleta();
    atualizarProximaPernaRoxa();
    ativarRastreamentoGeolocalizacaoAtiva();
    
    if (typeof salvarEstadoRota === "function") salvarEstadoRota();
}

async function desenharTrilhaMestreFixaCompleta() {
    try {
        let urlCoords = rotaSpx.map((_, i) => `${getAlvoData(i).lon},${getAlvoData(i).lat}`).join(';');
        let res = await fetch(`https://router.project-osrm.org/route/v1/driving/${urlCoords}?overview=full&geometries=geojson`);
        let data = await res.json();
        if (data.routes?.length > 0) trilhaMestreGps.setLatLngs(data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
    } catch(e){}
}

async function atualizarProximaPernaRoxa() {
    if (idxDestino >= rotaSpx.length - 1) {
        proximaPernaGps.setLatLngs([]); 
        return;
    }
    try {
        let alvoAtual = getAlvoData(idxDestino);
        let alvoProx = getAlvoData(idxDestino + 1);
        let coords = `${alvoAtual.lon},${alvoAtual.lat};${alvoProx.lon},${alvoProx.lat}`;
        
        let res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
        let data = await res.json();
        if (data.routes?.length > 0) proximaPernaGps.setLatLngs(data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
    } catch(e){}
}

function ativarRastreamentoGeolocalizacaoAtiva() {
    idRastreadorGps = navigator.geolocation.watchPosition(async pos => {
        minhaLat = pos.coords.latitude; minhaLon = pos.coords.longitude;
        
        // --- ODÔMETRO REAL: Soma a quilometragem percorrida ---
        if (latAntGps !== null && lonAntGps !== null) {
            let distPercorrida = dist(latAntGps, lonAntGps, minhaLat, minhaLon);
            // Ignora tremidas de sinal menores que 2 metros ou saltos absurdos maiores que 150m no mesmo segundo
            if (distPercorrida > 2 && distPercorrida < 150) {
                globalKmRealPercorrida += (distPercorrida / 1000);
            }
            if (pos.coords.speed && pos.coords.speed > 2 && pos.coords.heading !== null) headingCarro = Math.round(pos.coords.heading);
            else if (distPercorrida > 5) headingCarro = Math.round((Math.atan2(minhaLon - lonAntGps, minhaLat - latAntGps) * 180 / Math.PI + 360) % 360);
        }
        latAntGps = minhaLat; lonAntGps = minhaLon;

        if (!markerUserGps) markerUserGps = L.circleMarker([minhaLat, minhaLon], { color: '#007AFF', fillOpacity: 1, radius: 8, zIndexOffset: 1000 }).addTo(mapGps);
        else markerUserGps.setLatLng([minhaLat, minhaLon]);

        if (listaRadares.length > 0) {
            let radarProx = null, mDist = Infinity;
            listaRadares.forEach(r => { let dR = dist(minhaLat, minhaLon, r.lat, r.lon); if (dR <= 75 && dR < mDist) { mDist = dR; radarProx = r; } });
            let domAlert = document.getElementById('radar-alert');
            if (radarProx) { if (radarAtivo !== radarProx) { radarAtivo = radarProx; playBipeRadar(); domAlert.innerHTML = `📸 RADAR ${radarProx.speed ? radarProx.speed+'km/h':''}`; domAlert.style.display = 'flex'; } } 
            else { radarAtivo = null; domAlert.style.display = 'none'; }
        }

        const desviouDoTrilho = ultimaLatReq && dist(minhaLat, minhaLon, ultimaLatReq, ultimaLonReq) > 30;
        if (idxDestino < rotaSpx.length && !aguardandoConfirmacao) {
            if (passosNavegacao.length === 0 || desviouDoTrilho) {
                await recalcularRotaGpsTaticaProximoAlvo();
                ultimaLatReq = minhaLat; ultimaLonReq = minhaLon;
            }
            processarLogicaGuiamentoNavegacao();
        }

        // --- ZOOM DINÂMICO ---
        let zoomDesejado = aguardandoConfirmacao ? 16 : 18;
        if (mapGps.getZoom() !== zoomDesejado) mapGps.setZoom(zoomDesejado);
        mapGps.panTo([minhaLat, minhaLon]);

    }, () => {}, { enableHighAccuracy: true });
}

async function recalcularRotaGpsTaticaProximoAlvo() {
    if (idxDestino >= rotaSpx.length) return;
    let alvo = getAlvoData(idxDestino);
    
    let txtEnderecos = "";
    if (alvo.isVaga) {
        txtEnderecos = alvo.pacotes.map(p => {
            let volColor = getCorVolume(p.pacotes);
            let volPill = `<span style="background:${volColor.bg}; color:${volColor.color}; padding:2px 6px; border-radius:10px; font-size:12px; margin-left:5px;">${p.pacotes} vol</span>`;
            // ATUALIZAÇÃO: Usa a função formatarEnderecos que tem o botão invisível da câmera
            let endsFormatados = formatarEnderecos(p.enderecos, p.lat, p.lon);
            return `
            <div style="background: rgba(0,0,0,0.4); border-left: 4px solid #39FF14; padding: 8px; margin-bottom: 8px; border-radius: 5px; text-align: left;">
                <div style="font-size: 15px; color: #39FF14; font-weight: bold; margin-bottom: 5px;">🚶 STOP ${p.stop} ${volPill}</div>
                ${endsFormatados}
            </div>`;
        }).join('');
    } else {
        txtEnderecos = formatarEnderecos(alvo.obj.enderecos, alvo.lat, alvo.lon);
    }

    let corVol = getCorVolume(alvo.totalVol);
    let labelBadge = alvo.isVaga ? `${alvo.id} (Combo a Pé)` : (alvo.obj.extra ? `EXTRA ${alvo.id}` : `STOP ${alvo.id}`);
    let pill = `<span style="background:${corVol.bg}; color:${corVol.color}; padding:2px 8px; border-radius:10px; font-size:13px; margin-left:5px;">${alvo.totalVol} vol</span>`;
    
    document.getElementById('stop-badge').innerHTML = `<span style="color:#fff;">#${idxDestino+1}</span> ➔ <span style="color:${corVol.bg};">${labelBadge}</span> ${pill} ${alvo.comercial?'<span class="tag-comercial">🏢</span>':''}`;
    document.getElementById('lista-enderecos').innerHTML = txtEnderecos;

    if (markerDestGps) mapGps.removeLayer(markerDestGps);
    markerDestGps = L.circleMarker([alvo.lat, alvo.lon], { radius: 11, color: '#fff', fillColor: '#007AFF', fillOpacity: 1, weight: 3 }).addTo(mapGps);

    try {
        let url = `https://router.project-osrm.org/route/v1/driving/${minhaLon},${minhaLat};${alvo.lon},${alvo.lat}?steps=true&overview=full&geometries=geojson`;
        if (headingCarro !== null) url += `&bearings=${headingCarro},60;`;
        let res = await fetch(url); let data = await res.json();
        if (data.routes?.length > 0) {
            const r = data.routes[0];
            passosNavegacao = r.legs[0].steps.map(s => ({ lat: s.maneuver.location[1], lon: s.maneuver.location[0], manobra: s.maneuver.modifier || s.maneuver.type || "", rua: s.name || "Frente" }));
            idxPasso = 0; distAnteriorCurva = Infinity;
            rotaRealGps.setLatLngs(r.geometry.coordinates.map(c => [c[1], c[0]])); 
        }
    } catch(e){}
}

function processarLogicaGuiamentoNavegacao() {
    let alvo = getAlvoData(idxDestino);
    const dFinal = dist(minhaLat, minhaLon, alvo.lat, alvo.lon);
    
    document.getElementById('rodape-rua').innerText = "PREVISÃO DE CHEGADA";
    document.getElementById('rodape-dist').innerText = Math.ceil((dFinal/5.5)/60) + " min";

    // --- ENTRADA NA ZONA DE 30 METROS ---
    if (dFinal < 30) {
        if (!aguardandoConfirmacao) {
            aguardandoConfirmacao = true; 
            releaseWakeLock(); 
            
            // Pausa o cronômetro de movimento, pois agora o motorista desceu do carro
            if (ultimaHoraMovimento) {
                globalTempoMovimento += (new Date() - ultimaHoraMovimento);
            }
            
            document.getElementById('painel-rodape').style.display = 'none';
            document.getElementById('seta-flutuante').style.display = 'none';
            document.getElementById('painel-topo').classList.add('modo-confirmacao');
            document.getElementById('painel-acoes').style.display = 'flex'; 
            
            let containerCheck = document.getElementById('combo-checklist-container');
            containerCheck.innerHTML = '';
            
            if (alvo.isVaga) {
                containerCheck.style.display = 'block';
                document.getElementById('btn-confirmar-entrega').style.display = 'none';
                document.getElementById('btn-falhar-entrega').style.display = 'none';
                
                let htmlCheck = `<div style="color:#FFCC00; font-weight:bold; font-size:12px; margin-bottom:8px; text-transform:uppercase;">📦 CONCLUA O COMBO A PÉ NA RUA:</div>`;
                alvo.pacotes.forEach(p => {
                    htmlCheck += `
                    <div class="combo-check-item">
                        <span style="font-size:14px; font-weight:bold; color:#fff;">Stop ${p.stop}</span>
                        <input type="checkbox" class="chk-combo-item" data-stopid="${p.stop}" onchange="verificarLiberacaoBotoesVaga()">
                    </div>`;
                });
                containerCheck.innerHTML = htmlCheck;
            } else {
                containerCheck.style.display = 'none';
                document.getElementById('btn-confirmar-entrega').style.display = 'block';
                document.getElementById('btn-falhar-entrega').style.display = 'block';
            }
            
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]); 
        }
        return;
    }

    if (passosNavegacao.length > 0) {
        const pAtual = passosNavegacao[idxPasso]; if (!pAtual) return;
        const dC = dist(minhaLat, minhaLon, pAtual.lat, pAtual.lon);
        if (dC < distAnteriorCurva) distAnteriorCurva = dC;
        if (dC > distAnteriorCurva + 8 && distAnteriorCurva < 40) { if (idxPasso < passosNavegacao.length - 1) { idxPasso++; distAnteriorCurva = Infinity; } }
        
        let distSomada = 0, pLat = minhaLat, pLon = minhaLon, icone = "📦", achou = false;
        for (let i = idxPasso; i < passosNavegacao.length; i++) {
            let pf = passosNavegacao[i]; distSomada += dist(pLat, pLon, pf.lat, pf.lon);
            let m = pf.manobra ? String(pf.manobra).toLowerCase() : "";
            if (m.includes("left") || m.includes("right") || m.includes("uturn") || m.includes("back")) {
                if (m.includes("left")) icone = "⬅️"; else if (m.includes("right")) icone = "➡️"; else icone = "↩️";
                achou = true; break;
            }
            pLat = pf.lat; pLon = pf.lon;
        }
        if (achou) {
            document.getElementById('seta-dist').innerText = distSomada > 1000 ? (distSomada/1000).toFixed(1) + " km" : Math.round(distSomada) + " m";
            document.getElementById('seta-icon').innerText = icone;
            document.getElementById('seta-flutuante').style.display = 'block';
        } else document.getElementById('seta-flutuante').style.display = 'none';
    }
}

function verificarLiberacaoBotoesVaga() {
    let chks = document.querySelectorAll('.chk-combo-item');
    if (Array.from(chks).every(c => c.checked)) {
        document.getElementById('btn-confirmar-entrega').style.display = 'block';
        document.getElementById('btn-falhar-entrega').style.display = 'block';
    } else {
        document.getElementById('btn-confirmar-entrega').style.display = 'none';
        document.getElementById('btn-falhar-entrega').style.display = 'none';
    }
}

function atualizarCorPinoGPS(index, status) {
    if(isRotaManual) {
        let id = rotaSpx[index];
        if (id.startsWith("Vaga")) {
            let v = vagasCriadas.find(x => x.marker.spxId === id);
            if(v.gpsMarker) v.gpsMarker.setStyle({ fillColor: status === 'concluido' ? '#888' : '#ff0000', weight: 2 });
        } else {
            let p = planilhaStopsData.find(x => x.stop === id);
            if(p.gpsMarker) p.gpsMarker.setStyle({ fillColor: status === 'concluido' ? '#888' : '#ff0000', weight: 2 });
        }
    } else {
        if(rotaSpx[index].gpsMarker) rotaSpx[index].gpsMarker.setStyle({ fillColor: status === 'concluido' ? '#888' : '#ff0000', weight: 2 });
    }
}

function finalizarParadaAtual(status) {
    let alvo = getAlvoData(idxDestino);
    let agora = new Date();
    let tempoGasto = historicoParadas.length === 0 ? (agora - horaInicioExpediente) : (agora - historicoParadas[historicoParadas.length - 1].hora);

    // --- FILTRO ANTI-OCIOSIDADE ---
    if (tempoGasto > 45 * 60 * 1000) { 
        let excesso = tempoGasto - (15 * 60 * 1000); 
        globalTempoOcioso += excesso;
        tempoGasto = 15 * 60 * 1000; 
    }

    // Se ele forçou a baixa pelo menu longe do cliente, computa o movimento aqui
    if (!aguardandoConfirmacao && ultimaHoraMovimento) {
        globalTempoMovimento += (agora - ultimaHoraMovimento);
    }

    alvo.pacotes.forEach(p => {
        p.status = status;
        historicoParadas.push({ stop: p.stop, hora: agora, ms: Math.round(tempoGasto / alvo.pacotes.length), extra: p.extra, status: status });
    });
    
    atualizarCorPinoGPS(idxDestino, status);
    if (typeof salvarEstadoRota === "function") salvarEstadoRota();

    aguardandoConfirmacao = false; requestWakeLock();
    // Reinicia o relógio do movimento para a próxima perna da viagem
    ultimaHoraMovimento = new Date(); 

    document.getElementById('painel-rodape').style.display = 'block';
    document.getElementById('seta-flutuante').style.display = 'block';
    document.getElementById('painel-topo').classList.remove('modo-confirmacao');
    document.getElementById('combo-checklist-container').style.display = 'none';
    document.getElementById('painel-acoes').style.display = 'none';

    idxDestino++;
    passosNavegacao = [];
    
    if (idxDestino < rotaSpx.length) {
        recalcularRotaGpsTaticaProximoAlvo();
        atualizarProximaPernaRoxa();
    }
    else avaliarConclusaoExpedienteTotal();
}

function abrirMenuStops() {
    let html = '';
    for (let i = 0; i < rotaSpx.length; i++) {
        let alvo = getAlvoData(i);
        let isAtivo = (i === idxDestino);
        
        let corZebrada = i % 2 === 0 ? '#262626' : '#1a1a1a'; 
        let corFundo = isAtivo ? 'linear-gradient(135deg, #0055ff, #003399)' : corZebrada;
        let borda = isAtivo ? 'border: 2px solid #39FF14;' : 'border: 1px solid #333;';

        let statusIcon = alvo.status === 'concluido' ? '✅' : (alvo.status === 'pendente' ? '❌' : (isAtivo ? '📍' : (alvo.isVaga ? '🚙' : '📦')));
        let corTexto = alvo.status === 'concluido' ? '#888' : (alvo.status === 'pendente' ? '#ff6666' : '#fff');

        let botoesAcao = '';
        if (alvo.status === 'neutro') {
            botoesAcao = `
                <div style="margin-top:12px; display:flex; gap:10px;">
                    <button onclick="forcarBaixaMenu(event, ${i}, 'concluido')" class="btn-menu-acao btn-menu-check">✅ ENTREGUE ${alvo.isVaga ? '(TODOS)' : ''}</button>
                    <button onclick="forcarBaixaMenu(event, ${i}, 'pendente')" class="btn-menu-acao btn-menu-fail">❌ FALHA</button>
                </div>
            `;
        }

        let volColor = getCorVolume(alvo.totalVol);
        let volPill = `<span style="float:right; font-size:13px; background:${volColor.bg}; color:${volColor.color}; padding:2px 8px; border-radius:10px; font-weight:bold;">${alvo.totalVol} vol</span>`;
        
        let tagsHtml = '';
        if (alvo.comercial) tagsHtml += `<span class="tag-comercial" style="float:none; display:inline-block; margin-bottom:5px;">🏢 COMERCIAL</span> `;
        if (!alvo.isVaga && alvo.obj.extra) tagsHtml += `<span class="tag-extra" style="float:none; display:inline-block; margin-bottom:5px;">❓ EXTRA</span> `;

        let descInfo = '';
        if (alvo.isVaga) {
            let sugadosText = alvo.pacotes.map(p => {
                let pColor = getCorVolume(p.pacotes);
                return `Stop ${p.stop} <span style="color:${pColor.bg}; font-weight:bold;">(${p.pacotes}v)</span>`;
            }).join(', ');
            descInfo = `${tagsHtml}<br>Combo a pé contendo: ${sugadosText}`;
        } else {
            descInfo = `${tagsHtml}<br>${alvo.obj.ruaPadrao}`;
        }

        let labelPrincipal = alvo.isVaga ? alvo.id : (alvo.obj.extra ? "PACOTE EXTRA" : "Stop " + alvo.id);

        html += `
        <div style="background:${corFundo}; ${borda} border-radius:10px; padding:15px; margin-bottom:10px; text-align:left; color:${corTexto}; cursor:pointer;" onclick="pularParaStop(${i})">
            <div style="font-size:16px; font-weight:bold; color:${isAtivo ? '#fff' : (alvo.isVaga ? '#39FF14' : '#fff')}; margin-bottom: 5px;">
                ${statusIcon} <span style="color:#FFCC00;">#${i+1}</span> ➔ ${labelPrincipal}
                ${volPill}
            </div>
            <div style="font-size:13px; opacity:0.9; margin-top:3px; line-height: 1.5;">${descInfo}</div>
            ${botoesAcao}
        </div>`;
    }
    document.getElementById('conteudo-lista-stops').innerHTML = html;
    mostrarTela('modal-menu-stops', 'block');
}

function fecharMenuStops() { document.getElementById('modal-menu-stops').style.display = 'none'; }

function forcarBaixaMenu(e, index, status) {
    e.stopPropagation(); 
    let alvo = getAlvoData(index);
    let agora = new Date();
    let tempoGasto = historicoParadas.length === 0 ? (agora - horaInicioExpediente) : (agora - historicoParadas[historicoParadas.length - 1].hora);

    // --- FILTRO ANTI-OCIOSIDADE ---
    if (tempoGasto > 45 * 60 * 1000) { 
        let excesso = tempoGasto - (15 * 60 * 1000); 
        globalTempoOcioso += excesso;
        tempoGasto = 15 * 60 * 1000; 
    }

    if (!aguardandoConfirmacao && ultimaHoraMovimento) {
        globalTempoMovimento += (agora - ultimaHoraMovimento);
    }

    alvo.pacotes.forEach(p => {
        p.status = status;
        historicoParadas.push({ stop: p.stop, hora: agora, ms: Math.round(tempoGasto / alvo.pacotes.length), extra: p.extra, status: status });
    });
    
    atualizarCorPinoGPS(index, status);
    if (typeof salvarEstadoRota === "function") salvarEstadoRota(); 
    abrirMenuStops(); 

    if (index === idxDestino) {
        aguardandoConfirmacao = false; requestWakeLock();
        ultimaHoraMovimento = new Date();

        document.getElementById('painel-rodape').style.display = 'block';
        document.getElementById('seta-flutuante').style.display = 'block';
        document.getElementById('painel-topo').classList.remove('modo-confirmacao');
        document.getElementById('combo-checklist-container').style.display = 'none';
        document.getElementById('painel-acoes').style.display = 'none';
        
        idxDestino++; passosNavegacao = [];
        
        if (idxDestino < rotaSpx.length) {
            recalcularRotaGpsTaticaProximoAlvo();
            atualizarProximaPernaRoxa();
        }
        else avaliarConclusaoExpedienteTotal();
    } else {
        let tudoFinalizado = rotaSpx.every((_, i) => getAlvoData(i).status !== 'neutro');
        if (tudoFinalizado) avaliarConclusaoExpedienteTotal();
    }
}

function pularParaStop(index) {
    fecharMenuStops(); idxDestino = index; passosNavegacao = []; aguardandoConfirmacao = false;
    
    if (ultimaHoraMovimento) globalTempoMovimento += (new Date() - ultimaHoraMovimento);
    ultimaHoraMovimento = new Date();

    document.getElementById('painel-rodape').style.display = 'block';
    document.getElementById('seta-flutuante').style.display = 'block';
    document.getElementById('painel-acoes').style.display = 'none';
    document.getElementById('painel-topo').classList.remove('modo-confirmacao');
    document.getElementById('combo-checklist-container').style.display = 'none';
    
    recalcularRotaGpsTaticaProximoAlvo();
    atualizarProximaPernaRoxa(); 
}

function avaliarConclusaoExpedienteTotal() {
    if (idRastreadorGps !== null) navigator.geolocation.clearWatch(idRastreadorGps);

    releaseWakeLock();
    esconderTodasTelas();
    
    // Calcula o tempo bruto total do app aberto e desconta as pausas pesadas (almoço, soneca)
    let totalMsBruto = new Date() - horaInicioExpediente; 
    let totalMs = totalMsBruto - globalTempoOcioso; 
    if (totalMs <= 0) totalMs = 1000;
    
    // Calcula Tempo de Porta (Pausado) e Tempo de Volante (Movimento)
    let totalMovimento = globalTempoMovimento;
    let totalPausado = totalMsBruto - totalMovimento; 
    if (totalPausado < 0) totalPausado = 0;

    let concluidos = 0, totalVols = 0;
    rotaSpx.forEach((_, i) => {
        let alvo = getAlvoData(i);
        totalVols += alvo.totalVol;
        if(alvo.status === 'concluido') concluidos += alvo.totalVol;
    });
    
    let taxa = totalVols > 0 ? ((concluidos / totalVols) * 100).toFixed(1) : 0;
    let ritmo = totalMs > 0 ? Math.round(concluidos / (totalMs / 3600000)) : 0;

    // --- CORREÇÃO DA ENTREGA RÁPIDA (Filtra "0m 0s" e bugs do dedo nervoso) ---
    let paradasValidas = historicoParadas.filter(p => p.ms > 30000);
    let rapida = paradasValidas.sort((a,b) => a.ms - b.ms)[0];
    if (!rapida) rapida = historicoParadas.sort((a,b) => a.ms - b.ms)[0]; 
    let txtRapida = rapida ? `${Math.floor(rapida.ms/60000)}m ${Math.floor((rapida.ms%60000)/1000)}s (Stop ${rapida.stop})` : '--';

    // Insere os dados nas caixinhas do HTML
    document.getElementById('rel-movimento').innerText = Math.floor(totalMovimento/3600000) + "h " + Math.floor((totalMovimento%3600000)/60000) + "m";
    document.getElementById('rel-ocioso').innerText = Math.floor(totalPausado/3600000) + "h " + Math.floor((totalPausado%3600000)/60000) + "m";
    document.getElementById('rel-km-real').innerText = globalKmRealPercorrida.toFixed(1) + " km";
    
    document.getElementById('rel-ritmo').innerText = ritmo + " vol/h";
    document.getElementById('rel-sucesso').innerText = taxa + "%";
    document.getElementById('rel-raiox').innerText = `${rotaSpx.length} Paradas | ${totalVols} Vol`;
    document.getElementById('rel-rapida').innerText = txtRapida;

    if (isRotaManual) {
        document.querySelectorAll('.auto-metric').forEach(el => el.style.display = 'none');
    } else {
        document.querySelectorAll('.auto-metric').forEach(el => el.style.display = 'flex');
        document.getElementById('rel-km-otim').innerText = globalKmOtimizada.toFixed(2) + " km";
        let economia = (globalKmPadrao - globalKmOtimizada).toFixed(2);
        document.getElementById('rel-km-poupado').innerText = (economia < 0 ? 0 : economia) + " km";
    }

    mostrarTela('modal-relatorio');
}
