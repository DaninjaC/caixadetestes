/* ========================================= */
/* motor-doca.js - Tela de Separação (Bags)  */
/* ========================================= */

function renderizarModoDoca() {
    let container = document.getElementById('lista-bags'); 
    container.innerHTML = '';
    let html = '', bagNum = 1, globalIndex = 1;
    let listaCompletaDoca = [];

    // Tradutor de Rota (Normaliza dados do Manual e do Automático)
    if (isRotaManual) {
        rotaSpx.forEach(id => {
            if (id.startsWith("Vaga")) {
                let vObj = vagasCriadas.find(x => x.marker.spxId === id);
                let itensInternos = vObj ? vObj.sugados.map(m => planilhaStopsData.find(p => p.stop === m.spxId)) : [];
                let volTotal = itensInternos.reduce((acc, current) => acc + current.pacotes, 0);
                listaCompletaDoca.push({ id: id, isVaga: true, totalVol: volTotal, subItems: itensInternos });
            } else {
                let pObj = planilhaStopsData.find(x => x.stop === id);
                if(pObj) listaCompletaDoca.push({ id: id, isVaga: false, obj: pObj });
            }
        });
    } else {
        // Se for o Robô Automático, trata tudo como paradas normais (algumas com tag a pé)
        rotaSpx.forEach(pObj => {
            listaCompletaDoca.push({ id: "Stop " + pObj.stop, isVaga: false, obj: pObj });
        });
    }

    // Fatiamento de 10 em 10 pacotes
    for (let i = 0; i < listaCompletaDoca.length; i += 10) {
        let lote = listaCompletaDoca.slice(i, i + 10);
        html += `<div class="bag-container"><h3>BAG ${bagNum} (Lotes ${i+1} a ${i+lote.length})</h3>`;
        
        lote.forEach(item => {
            if (item.isVaga) {
                let sugadosFormatados = item.subItems.map(s => `Stop ${s.stop} (${s.pacotes} vol)`).join(', ');
                html += `
                <div class="bag-item" style="border-left: 4px solid #007AFF; padding-left: 8px;">
                    <div>
                        <strong><span style="color:#FFCC00;">#${globalIndex}</span> ➔ ${item.id} <span class="tag-vaga-combo">COMBO A PÉ</span></strong>
                        <small style="color:#007AFF;">Agrupados: ${sugadosFormatados}</small>
                    </div>
                    <div class="bag-vol" style="background:#007AFF; color:#fff;">${item.totalVol} vol</div>
                </div>`;
            } else {
                let p = item.obj;
                let tags = p.comercial ? `<span class="tag-comercial">🏢 COMERCIAL</span>` : '';
                let label = p.extra ? `[❓ EXTRA ${p.stop}]` : `[Stop ${p.stop}]`;
                if (!isRotaManual && p.andaAPe) tags += `<span style="color:#39FF14; font-size:11px; font-weight:bold;">🚶 A Pé</span>`;
                let volColor = getCorVolume(p.pacotes);
                html += `
                <div class="bag-item">
                    <div>
                        <strong><span style="color:#FFCC00;">#${globalIndex}</span> ➔ ${label}</strong>
                        <small>${p.ruaPadrao}</small>${tags ? '<br>'+tags : ''}
                    </div>
                    <div class="bag-vol" style="background:${volColor.bg}; color:${volColor.color};">${p.pacotes} vol</div>
                </div>`;
            }
            globalIndex++;
        });
        html += `</div>`; bagNum++;
    }
    container.innerHTML = html;
}

// Botão da tela de Doca aciona o motor de GPS
function iniciarGPSPosDoca() {
    esconderTodasTelas();
    mostrarTela('tela-navegacao');
    iniciarInterfaceGPS();
}
