/* ========================================= */
/* leitor.js - Leitura e Processamento Excel */
/* ========================================= */

document.getElementById('fileInput').addEventListener('change', async function(e) {
    // 1. Limpeza Imediata da Memória: Esconde botão e apaga rota velha
    let btnCont = document.getElementById('btn-continuar');
    if (btnCont) btnCont.style.display = 'none';
    localStorage.removeItem('spx_ninja_estado');

    // 2. Mudança Visual
    document.getElementById('btnLabel').style.display = 'none';
    document.getElementById('faq-box').style.display = 'none';
    document.getElementById('loading-msg').style.display = 'block';
    
    const reader = new FileReader();
    requestWakeLock(); 

    reader.onload = async function(evt) {
        try {
            const wb = XLSX.read(evt.target.result, { type: 'binary' });
            const dataRaw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            
            const json = dataRaw.map(row => {
                const normalized = {};
                for (let key in row) normalized[key.trim().toLowerCase()] = row[key];
                return normalized;
            });

            const contagemVolumes = {};
            const listaEnderecosPorStop = {};
            const dadosComerciais = {};
            const regexComercial = /galp[aã]o|loja|sala|comercial|empresa|cl[íi]nica|consult[oó]rio|escola|pr[eé]dio|shopping|igreja|oficina|galeria|instituto|studio|centro/i;

            let pacotesMisteriososRaw = [];
            let paradasOficiaisRaw = [];

            json.forEach(i => { 
                let s = i.stop || i.parada || i.sequence;
                let end = i["destination address"] || i.endereco || "S/N";
                let compl = i.complemento || "";
                let isComercial = regexComercial.test(end) || regexComercial.test(compl);

                if (!s || String(s).trim() === '-' || isNaN(parseInt(s))) {
                    pacotesMisteriososRaw.push({
                        lat: parseFloat(String(i.latitude || i.lat).replace(',', '.')),
                        lon: parseFloat(String(i.longitude || i.lon || i.lng).replace(',', '.')),
                        ruaPadrao: extrairRuaPadrao(end),
                        endereco: end,
                        comercial: isComercial,
                        pacotes: 1
                    });
                } else {
                    let numStop = parseInt(s);
                    contagemVolumes[numStop] = (contagemVolumes[numStop] || 0) + 1; 
                    if (!listaEnderecosPorStop[numStop]) listaEnderecosPorStop[numStop] = [];
                    listaEnderecosPorStop[numStop].push(end);
                    if (isComercial) dadosComerciais[numStop] = true;
                    paradasOficiaisRaw.push({ ...i, stopLimpo: numStop });
                }
            });

            const stopsUnicos = new Set();

            planilhaStopsData = paradasOficiaisRaw.filter(i => {
                    let s = i.stopLimpo;
                    if (stopsUnicos.has(s)) return false; 
                    stopsUnicos.add(s); return true;
                })
                .sort((a, b) => a.stopLimpo - b.stopLimpo)
                .map((i, index) => {
                    let s = i.stopLimpo;
                    return {
                        idOriginal: index, 
                        lat: parseFloat(String(i.latitude || i.lat).replace(',', '.')),
                        lon: parseFloat(String(i.longitude || i.lon || i.lng).replace(',', '.')),
                        ruaPadrao: extrairRuaPadrao(i["destination address"] || i.endereco),
                        stop: s.toString(), 
                        pacotes: contagemVolumes[s], 
                        enderecos: listaEnderecosPorStop[s], 
                        comercial: dadosComerciais[s] || false,
                        extra: false,
                        status: 'neutro'
                    };
                })
                .filter(i => !isNaN(i.lat) && !isNaN(i.lon));

            let cExtra = 1;
            pacotesMisteriososRaw.forEach(e => {
                if (isNaN(e.lat) || isNaN(e.lon)) return;
                planilhaStopsData.push({
                    idOriginal: 9999 + cExtra, lat: e.lat, lon: e.lon, ruaPadrao: e.ruaPadrao,
                    stop: "E" + cExtra, pacotes: e.pacotes, enderecos: [e.endereco],
                    comercial: e.comercial, extra: true, status: 'neutro'
                });
                cExtra++;
            });

            if (planilhaStopsData.length === 0) throw new Error("Sem coordenadas válidas.");

            esconderTodasTelas();
            mostrarTela('modal-escolha-modo');

        } catch (err) {
            alert("Erro ao processar planilha: " + err.message);
            document.getElementById('loading-msg').style.display = 'none';
            document.getElementById('btnLabel').style.display = 'inline-block';
            document.getElementById('faq-box').style.display = 'block';
        }
    };
    reader.readAsBinaryString(e.target.files[0]);
});
