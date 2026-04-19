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
              // Retell peut envoyer les données dans event.call (format actuel) ou event.data (ancien)
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
                  { headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' } }
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
                  { headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` } }
                      );
              if (!response.data.records.length) return res.status(404).send('<h2>Commande introuvable</h2>');
              const f = response.data.records[0].fields;
              const now = new Date().toLocaleString('fr-FR');
              res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Ticket ${f['N° Commande']}</title> <style>body{font-family:'Courier New',monospace;max-width:310px;margin:20px auto;padding:15px;font-size:13px}.center{text-align:center}.bold{font-weight:bold}.large{font-size:18px}.sep{border-top:2px dashed #000;margin:10px 0}.row{display:flex;justify-content:space-between;margin:3px 0}.badge{background:#000;color:#fff;padding:5px 12px;display:inline-block;font-size:16px;margin:5px 0;border-radius:4px;letter-spacing:1px}.detail{background:#f5f5f5;padding:8px;margin:5px 0;white-space:pre-wrap;font-size:12px;border-left:3px solid #000}.total{font-size:20px;font-weight:bold}@media print{.no-print{display:none!important}body{margin:0;max-width:100%}}</style> </head><body> <div class="center"><div style="font-size:24px">🍕</div><div class="bold large">PIZZA TRATTORIA</div><div class="sep"></div><div class="badge">${f['N° Commande']}</div><div style="font-size:11px">${now}</div></div> <div class="sep"></div> <div class="row"><span class="bold">Client :</span><span>${f['Nom Client']||'N/A'}</span></div> <div class="row"><span class="bold">Tél :</span><span>${f['Téléphone']||'N/A'}</span></div> <div class="row"><span class="bold">Mode :</span><span class="bold" style="text-transform:uppercase">${f['Type']||'N/A'}</span></div> ${f['Adresse Livraison']?'<div class="row"><span class="bold">Adresse :</span><span>'+f['Adresse Livraison']+'</span></div>':''} <div class="sep"></div> <div class="bold">COMMANDE :</div><div class="detail">${f['Détail Commande']||'N/A'}</div> <div class="sep"></div> <div class="row"><span class="total">TOTAL :</span><span class="total">${f['Montant (€)']?parseFloat(f['Montant (€)']).toFixed(2)+' €':'N/A'}</span></div> <div class="sep"></div> <div class="center"><div class="bold">⏱ Délai : ${f['Délai']||'N/A'}</div><div style="font-size:10px;margin-top:8px">Merci ! Pizza Trattoria 🍕</div></div> <div class="sep no-print"></div><div class="center no-print" style="margin:15px 0"><button onclick="window.print()" style="background:#dc2626;color:#fff;border:none;padding:10px 24px;font-size:15px;border-radius:6px;cursor:pointer;font-weight:bold">🖨️ IMPRIMER</button></div> </body></html>`);
      } catch(err){ res.status(500).send('Erreur: '+err.message); }
});

app.get('/dashboard', async (req, res) => {
      try {
              const resp = await axios.get(
                        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}?sort[0][field]=Date&sort[0][direction]=desc&maxRecords=100`,
                  { headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` } }
                      );
              const records = resp.data.records;
              const today = new Date().toLocaleDateString('fr-FR');
              const todayRecs = records.filter(r => r.fields.Date && new Date(r.fields.Date).toLocaleDateString('fr-FR') === today);
              const rows = records.map(r => {
                        const f = r.fields;
                        const date = f.Date ? new Date(f.Date).toLocaleString('fr-FR') : 'N/A';
                        const montant = f['Montant (€)'] != null ? parseFloat(f['Montant (€)']).toFixed(2)+' €' : 'N/A';
                        const statut = f.Statut || 'Nouvelle';
                        const colors = {'Nouvelle':'#3b82f6','En préparation':'#f59e0b','Prête':'#8b5cf6','Livrée':'#22c55e','Annulée':'#ef4444'};
                        const color = colors[statut]||'#6b7280';
                        const tc = f.Type==='Livraison'?'#f59e0b':'#10b981';
                        return `<tr><td style="font-weight:bold;font-family:monospace">${f['N° Commande']||'-'}</td><td>${f['Nom Client']||'-'}</td><td>${f['Téléphone']||'-'}</td><td><span style="background:${tc};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:bold">${f.Type||'-'}</span></td><td style="font-size:11px;max-width:200px">${(f['Détail Commande']||'-').substring(0,80)}</td><td style="font-weight:bold;color:#dc2626">${montant}</td><td><select onchange="updateStatus('${r.id}',this.value)" style="border:1px solid ${color};color:${color};padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;background:white;cursor:pointer">${['Nouvelle','En préparation','Prête','Livrée','Annulée'].map(s=>`<option ${s===statut?'selected':''} value="${s}">${s}</option>`).join('')}</select></td><td style="font-size:11px">${date}</td><td><a href="/ticket/${encodeURIComponent(f['N° Commande'])}" target="_blank" style="background:#111;color:#fff;padding:4px 10px;text-decoration:none;border-radius:4px;font-size:11px;font-weight:bold">🖨️</a></td></tr>`;
              }).join('');
              const totalJour = todayRecs.reduce((s,r)=>s+(r.fields['Montant (€)']||0),0);
              res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>🍕 Pizza Trattoria POS</title> <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;color:#111827}.header{background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}.header h1{font-size:20px}.container{padding:20px 24px}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:24px}.card{background:#fff;border-radius:10px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.08);border-left:4px solid}.card.red{border-color:#dc2626}.card.blue{border-color:#3b82f6}.card.green{border-color:#22c55e}.card.orange{border-color:#f59e0b}.card .val{font-size:28px;font-weight:800}.card .lbl{font-size:12px;color:#6b7280;margin-top:2px}.table-wrap{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden}table{width:100%;border-collapse:collapse}th{background:#f9fafb;padding:10px 12px;text-align:left;font-size:11px;color:#9ca3af;text-transform:uppercase}td{padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;vertical-align:middle}tr:hover td{background:#fef2f2}.btn{background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.4);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px}</style> <script>let cd=30;setInterval(()=>{cd--;const el=document.getElementById('cd');if(el)el.textContent=cd+'s';if(cd<=0)location.reload();},1000);async function updateStatus(id,status){try{await fetch('/update-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordId:id,status})});}catch(e){}}</script> </head><body> <div class="header"><span style="font-size:30px">🍕</span><div><h1>Pizza Trattoria — POS Dashboard</h1><div style="font-size:12px;opacity:.8">Refresh auto dans <span id="cd">30</span>s</div></div><div style="margin-left:auto"><button class="btn" onclick="location.reload()">↻ Refresh</button></div></div> <div class="container"> <div class="stats"> <div class="card red"><div class="val">${todayRecs.length}</div><div class="lbl">Commandes aujourd'hui</div></div> <div class="card blue"><div class="val">${todayRecs.filter(r=>r.fields.Type==='Livraison').length}</div><div class="lbl">Livraisons</div></div> <div class="card green"><div class="val">${todayRecs.filter(r=>r.fields.Type==='Emporter').length}</div><div class="lbl">À emporter</div></div> <div class="card orange"><div class="val">${totalJour.toFixed(2)} €</div><div class="lbl">CA du jour</div></div> </div> <div class="table-wrap"> <div style="padding:14px 20px;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center"><strong>📋 Commandes (${records.length})</strong><span style="font-size:12px;color:#9ca3af">Triées par date</span></div> <table><thead><tr><th>N° Commande</th><th>Client</th><th>Téléphone</th><th>Type</th><th>Détail</th><th>Montant</th><th>Statut</th><th>Date</th><th>Ticket</th></tr></thead> <tbody>${rows}</tbody></table> </div></div></body></html>`);
      } catch(err){ res.status(500).send('Erreur: '+err.message); }
});

app.post('/update-status', async (req, res) => {
      try {
              const { recordId, status } = req.body;
              await axios.patch(
                        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}/${recordId}`,
                  { fields: { Statut: status } },
                  { headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' } }
                      );
              res.json({ success: true });
      } catch(err){ res.status(500).json({ error: err.message }); }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Pizza Trattoria POS', version: '1.1.0' }));

app.listen(PORT, () => console.log('🍕 POS lancé sur port', PORT));
