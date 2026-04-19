const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = 'Commandes';
const PORT = process.env.PORT || 3000;

function generateOrderNumber() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return 'CMD-' + pad(now.getDate()) + pad(now.getMonth()+1) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + '-' + Math.floor(Math.random()*100).toString().padStart(2,'0');
}

function isConfirmed(val) {
        if (val === true) return true;
        if (val == null) return false;
        const s = String(val).toLowerCase().trim().replace(/[éèê]/g, 'e');
        const ok = ['oui','yes','y','true','ok','1','confirmee','confirme','validee','valide'];
        return ok.includes(s);
}

app.post('/webhook/retell', async (req, res) => {
        try {
                  const event = req.body || {};
                  const callData = event.call || event.data || {};
                  const eventType = event.event || event.event_type || '';
                  const callId = callData.call_id || event.call_id || 'unknown';
                  console.log('Event:', eventType, '| Call:', callId);

          if (eventType !== 'call_analyzed') return res.status(200).json({ status: 'ignored', event: eventType });

          const custom = callData.call_analysis?.custom_analysis_data || {};
                  console.log('Custom data:', JSON.stringify(custom));

          if (!isConfirmed(custom.commande_confirmee)) return res.status(200).json({ status: 'ignored', reason: 'non_confirmee', value: custom.commande_confirmee });

          const numeroCommande = generateOrderNumber();
                  const type = (custom.type_commande || 'emporter').toString().toLowerCase();
                  const fields = {
                              'N° Commande': numeroCommande,
                              'Nom Client': custom.nom_client || 'Inconnu',
                              'Téléphone': custom.telephone_client || callData.from_number || 'N/A',
                              'Type': type.charAt(0).toUpperCase() + type.slice(1),
                              'Adresse Livraison': custom.adresse_livraison || '',
                              'Détail Commande': custom.detail_commande || callData.call_analysis?.call_summary || '',
                              'Montant (€)': parseFloat(String(custom.montant_total).replace(',', '.')) || 0,
                              'Délai': type === 'livraison' ? '50 min' : '35 min',
                              'Statut': 'Nouvelle',
                              'Call ID': callId,
                              'Durée Appel': callData.duration_ms ? Math.round(callData.duration_ms/1000)+'s' : 'N/A',
                              'Date': new Date().toISOString()
                  };

          const airtableRes = await axios.post(
                      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`,
                { fields },
                {
                              headers: {
                                              'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                                              'Content-Type': 'application/json'
                              }
                }
                    );
                  console.log('OK:', numeroCommande, airtableRes.data.id);
                  res.status(200).json({ status: 'success', order_number: numeroCommande });
        } catch (err) {
                  console.error('Error:', err.response?.data || err.message, err.stack);
                  res.status(500).json({ status: 'error', message: err.message });
        }
});

app.get('/ticket/:orderId', async (req, res) => {
        try {
                  const orderId = req.params.orderId;
                  const response = await axios.get(
                              `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}?filterByFormula=FIND("${orderId}",{N° Commande})>0`,
                        {
                                      headers: {
                                                      'Authorization': `Bearer ${AIRTABLE_API_KEY}`
                                      }
                        }
                            );
                  if (!response.data.records.length) return res.status(404).send('<h2>Commande introuvable</h2>');

          const f = response.data.records[0].fields;
                  const now = new Date().toLocaleString('fr-FR');
                  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Ticket ${f['N° Commande']}</title><style>body{font-family:'Courier New',monospace;max-width:310px;margin:20px auto;padding:15px;font-size:13px}.center{text-align:center}.bold{font-weight:bold}.large{font-size:18px}.sep{border-top:2px dashed #000;margin:10px 0}.row{display:flex;justify-content:space-between;margin:3px 0}.badge{background:#000;color:#fff;padding:5px 12px;display:inline-block;font-size:16px;margin:5px 0;border-radius:4px;letter-spacing:1px}.detail{background:#f5f5f5;padding:8px;margin:5px 0;white-space:pre-wrap;font-size:12px;border-left:3px solid #000}.total{font-size:20px;font-weight:bold}@media print{.no-print{display:none!important}body{margin:0;max-width:100%}}</style></head><body><div class="center"><div style="font-size:24px">🍕</div><div class="bold large">PIZZA TRATTORIA</div><div class="sep"></div><div class="badge">${f['N° Commande']}</div><div style="font-size:11px">${now}</div></div><div class="sep"></div><div class="row"><span class="bold">Client :</span><span>${f['Nom Client']||'N/A'}</span></div><div class="row"><span class="bold">Tél :</span><span>${f['Téléphone']||'N/A'}</span></div><div class="row"><span class="bold">Mode :</span><span class="bold" style="text-transform:uppercase">${f['Type']||'N/A'}</span></div>${f['Adresse Livraison']?'<div class="row"><span class="bold">Adresse :</span><span>'+f['Adresse Livraison']+'</span></div>':''}<div class="sep"></div><div class="bold">COMMANDE :</div><div class="detail">${f['Détail Commande']||'N/A'}</div><div class="sep"></div><div class="row"><span class="total">TOTAL :</span><span class="total">${f['Montant (€)']?parseFloat(f['Montant (€)']).toFixed(2)+' €':'N/A'}</span></div><div class="sep"></div><div class="center"><div class="bold">⏱ Délai : ${f['Délai']||'N/A'}</div><div style="font-size:10px;margin-top:8px">Merci ! Pizza Trattoria 🍕</div></div><div class="sep no-print"></div><div class="center no-print" style="margin:15px 0"><button onclick="window.print()" style="background:#dc2626;color:#fff;border:none;padding:10px 24px;font-size:15px;border-radius:6px;cursor:pointer;font-weight:bold">🖨️ IMPRIMER</button></div></body></html>`);
        } catch(err){
                  res.status(500).send('Erreur: '+err.message);
        }
});

app.get('/api/orders', async (req, res) => {
        try {
                  const resp = await axios.get(
                              `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}?sort[0][field]=Date&sort[0][direction]=desc&maxRecords=100`,
                        {
                                      headers: {
                                                      'Authorization': `Bearer ${AIRTABLE_API_KEY}`
                                      }
                        }
                            );
                  const records = resp.data.records;
                  const today = new Date().toLocaleDateString('fr-FR');
                  const todayRecs = records.filter(r => r.fields.Date && new Date(r.fields.Date).toLocaleDateString('fr-FR') === today);

          // IMPORTANT: Exclure les commandes ANNULÉES du CA
          const todayValidRecs = todayRecs.filter(r => r.fields.Statut !== 'Annulée');
                  const totalJour = todayValidRecs.reduce((s,r)=>s+(r.fields['Montant (€)']||0),0);

          res.json({
                      records,
                      todayRecs,
                      todayValidRecs,
                      totalJour: parseFloat(totalJour.toFixed(2)),
                      today
          });
        } catch(err){
                  res.status(500).json({ error: err.message });
        }
});

app.get('/dashboard', async (req, res) => {
        try {
                  const resp = await axios.get(
                              `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}?sort[0][field]=Date&sort[0][direction]=desc&maxRecords=100`,
                        {
                                      headers: {
                                                      'Authorization': `Bearer ${AIRTABLE_API_KEY}`
                                      }
                        }
                            );
                  const records = resp.data.records;
                  const today = new Date().toLocaleDateString('fr-FR');
                  const todayRecs = records.filter(r => r.fields.Date && new Date(r.fields.Date).toLocaleDateString('fr-FR') === today);
                  const todayValidRecs = todayRecs.filter(r => r.fields.Statut !== 'Annulée');
                  const totalJour = todayValidRecs.reduce((s,r)=>s+(r.fields['Montant (€)']||0),0);

          const rows = records.map(r => {
                      const f = r.fields;
                      const date = f.Date ? new Date(f.Date).toLocaleString('fr-FR') : 'N/A';
                      const montant = f['Montant (€)'] != null ? parseFloat(f['Montant (€)']).toFixed(2)+' €' : 'N/A';
                      const statut = f.Statut || 'Nouvelle';
                      const colors = {'Nouvelle':'#3b82f6','En préparation':'#f59e0b','Prête':'#8b5cf6','Livrée':'#22c55e','Annulée':'#ef4444'};
                      const color = colors[statut]||'#6b7280';
                      const tc = f.Type==='Livraison'?'#f59e0b':'#10b981';
                      return `<tr data-id="${r.id}"><td style="font-weight:bold;font-family:monospace">${f['N° Commande']||'-'}</td><td>${f['Nom Client']||'-'}</td><td>${f['Téléphone']||'-'}</td><td><span style="background:${tc};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:bold">${f.Type||'-'}</span></td><td style="font-size:11px;max-width:200px;word-break:break-word">${(f['Détail Commande']||'-').substring(0,80)}</td><td style="font-weight:bold;color:#dc2626">${montant}</td><td><select onchange="updateStatus('${r.id}',this.value)" style="border:1px solid ${color};color:${color};padding:4px 8px;border-radius:4px;font-size:11px;font-weight:bold;background:white;cursor:pointer">${['Nouvelle','En préparation','Prête','Livrée','Annulée'].map(s=>`<option ${s===statut?'selected':''} value="${s}">${s}</option>`).join('')}</select></td><td style="font-size:11px">${date}</td><td><a href="/ticket/${encodeURIComponent(f['N° Commande'])}" target="_blank" style="background:#111;color:#fff;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:11px;font-weight:bold">🖨️</a></td></tr>`;
          }).join('');

          res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>🍕 Pizza Trattoria POS</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;color:#111827}.header{background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:16px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100;flex-wrap:wrap}.header h1{font-size:18px;flex:1;min-width:200px}.container{padding:20px 16px;max-width:1600px;margin:0 auto}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}.card{background:#fff;border-radius:8px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.08);border-left:4px solid;transition:all .2s}.card:hover{box-shadow:0 4px 8px rgba(0,0,0,.12)}.card.red{border-color:#dc2626}.card.blue{border-color:#3b82f6}.card.green{border-color:#22c55e}.card.orange{border-color:#f59e0b}.card .val{font-size:24px;font-weight:800}.card .lbl{font-size:11px;color:#6b7280;margin-top:4px}.table-wrap{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden}.table-header{padding:12px 16px;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}.table-header strong{font-size:13px}.table-header span{font-size:11px;color:#9ca3af}table{width:100%;border-collapse:collapse}th{background:#f9fafb;padding:8px 12px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600}td{padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;vertical-align:middle}tr:hover td{background:#fef2f2}select{border:1px solid;padding:4px 8px;border-radius:4px;font-size:11px;font-weight:bold;background:white;cursor:pointer;transition:.15s}.btn{background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.4);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;transition:.2s}.btn:hover{background:rgba(255,255,255,.3)}.spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:768px){.header{padding:12px 14px}.header h1{font-size:16px}.container{padding:12px 12px}.stats{grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px}.card{padding:10px 12px}.card .val{font-size:20px}.table-header{font-size:11px}.table-wrap{overflow-x:auto}table{font-size:10px}td,th{padding:6px 8px}select{padding:3px 6px;font-size:10px}}@media(max-width:480px){.header{gap:8px}.header h1{font-size:14px}.container{padding:8px}.stats{grid-template-columns:1fr;gap:8px}.card{padding:8px 10px}.card .val{font-size:18px}.card .lbl{font-size:10px}.table-header{flex-direction:column;align-items:flex-start}.table-wrap{font-size:9px}table{font-size:9px}td,th{padding:4px 6px}}</style></head><body><div class="header"><span style="font-size:24px">🍕</span><div><h1>Pizza Trattoria — POS</h1><div style="font-size:10px;opacity:.8">Auto-refresh <span id="cd">15</span>s</div></div><button class="btn" id="refreshBtn" onclick="location.reload()">↻ Refresh</button></div><div class="container"><div class="stats"><div class="card red"><div class="val" id="val-today">${todayRecs.length}</div><div class="lbl">Cmd aujourd'hui</div></div><div class="card blue"><div class="val" id="val-livraison">${todayRecs.filter(r=>r.fields.Type==='Livraison').length}</div><div class="lbl">Livraisons</div></div><div class="card green"><div class="val" id="val-emporter">${todayRecs.filter(r=>r.fields.Type==='Emporter').length}</div><div class="lbl">À emporter</div></div><div class="card orange"><div class="val" id="val-total">${totalJour.toFixed(2)} €</div><div class="lbl">CA du jour</div></div></div><div class="table-wrap"><div class="table-header"><strong>📋 Commandes (${records.length})</strong><span>Triées par date</span></div><table id="orders-table"><thead><tr><th>N° Cmd</th><th>Client</th><th>Tél</th><th>Type</th><th>Détail</th><th>Montant</th><th>Statut</th><th>Date</th><th>Ticket</th></tr></thead><tbody>${rows}</tbody></table></div></div><script>let autoRefreshTimeout;function resetAutoRefresh(){clearTimeout(autoRefreshTimeout);let cd=15;document.getElementById('cd').textContent=cd+'s';const interval=setInterval(()=>{cd--;document.getElementById('cd').textContent=cd+'s';if(cd<=0){clearInterval(interval);location.reload()}},1000);autoRefreshTimeout=setTimeout(()=>{location.reload()},15000)}resetAutoRefresh();async function updateStatus(id,status){try{const refreshBtn=document.getElementById('refreshBtn');refreshBtn.textContent='↻ ';const spinner=document.createElement('span');spinner.className='spinner';refreshBtn.appendChild(spinner);const res=await fetch('/update-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordId:id,status})});if(res.ok){await refreshTable()}else{alert('Erreur: '+res.statusText)}refreshBtn.textContent='↻ Refresh';resetAutoRefresh()}catch(e){console.error(e);alert('Erreur: '+e.message)}}async function refreshTable(){try{const res=await fetch('/api/orders');const data=await res.json();if(!res.ok)throw new Error(data.error);const{records,todayRecs,todayValidRecs,totalJour}=data;document.getElementById('val-today').textContent=todayRecs.length;document.getElementById('val-livraison').textContent=todayRecs.filter(r=>r.fields.Type==='Livraison').length;document.getElementById('val-emporter').textContent=todayRecs.filter(r=>r.fields.Type==='Emporter').length;document.getElementById('val-total').textContent=totalJour.toFixed(2)+' €';const tbody=document.querySelector('#orders-table tbody');tbody.innerHTML='';records.forEach(r=>{const f=r.fields;const date=f.Date?new Date(f.Date).toLocaleString('fr-FR'):'N/A';const montant=f['Montant (€)']!=null?parseFloat(f['Montant (€)']).toFixed(2)+' €':'N/A';const statut=f.Statut||'Nouvelle';const colors={'Nouvelle':'#3b82f6','En préparation':'#f59e0b','Prête':'#8b5cf6','Livrée':'#22c55e','Annulée':'#ef4444'};const color=colors[statut]||'#6b7280';const tc=f.Type==='Livraison'?'#f59e0b':'#10b981';const tr=document.createElement('tr');tr.setAttribute('data-id',r.id);tr.innerHTML=`<td style="font-weight:bold;font-family:monospace">${f['N° Commande']||'-'}</td><td>${f['Nom Client']||'-'}</td><td>${f['Téléphone']||'-'}</td><td><span style="background:\${tc};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:bold">\${f.Type||'-'}</span></td><td style="font-size:11px;max-width:200px;word-break:break-word">\${(f['Détail Commande']||'-').substring(0,80)}</td><td style="font-weight:bold;color:#dc2626">\${montant}</td><td><select onchange="updateStatus('\${r.id}',this.value)" style="border:1px solid \${color};color:\${color};padding:4px 8px;border-radius:4px;font-size:11px;font-weight:bold;background:white;cursor:pointer">\${['Nouvelle','En préparation','Prête','Livrée','Annulée'].map(s=>\`<option \${s===statut?'selected':''} value="\${s}">\${s}</option>\`).join('')}</select></td><td style="font-size:11px">\${date}</td><td><a href="/ticket/\${encodeURIComponent(f['N° Commande'])}" target="_blank" style="background:#111;color:#fff;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:11px;font-weight:bold">🖨️</a></td>`;tbody.appendChild(tr)})}catch(e){console.error(e)}}document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(autoRefreshTimeout)}else{resetAutoRefresh()}})</script></body></html>`);
} catch(err){
          res.status(500).send('Erreur: '+err.message);
}
});

app.post('/update-status', async (req, res) => {
        try {
                  const { recordId, status } = req.body;
                  await axios.patch(
                              `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}/${recordId}`,
                        { fields: { Statut: status } },
                        {
                                      headers: {
                                                      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                                                      'Content-Type': 'application/json'
                                      }
                        }
                            );
                  res.json({ success: true });
        } catch(err){
                  res.status(500).json({ error: err.message });
        }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Pizza Trattoria POS', version: '2.0.0' }));

app.listen(PORT, () => console.log('🍕 POS lancé sur port', PORT));
