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

// Webhook Retell - inchange, fonctionne tres bien
app.post('/webhook/retell', async (req, res) => {
  try {
    const event = req.body || {};
    const callData = event.call || event.data || {};
    const eventType = event.event || event.event_type || '';
    const callId = callData.call_id || event.call_id || 'unknown';
    console.log('Event:', eventType, '| Call:', callId);
    if (eventType !== 'call_analyzed') return res.status(200).json({ status: 'ignored', event: eventType });
    const custom = (callData.call_analysis && callData.call_analysis.custom_analysis_data) ? callData.call_analysis.custom_analysis_data : {};
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
      'Détail Commande': custom.detail_commande || (callData.call_analysis && callData.call_analysis.call_summary) || '',
      'Montant (€)': parseFloat(String(custom.montant_total).replace(',', '.')) || 0,
      'Délai': type === 'livraison' ? '50 min' : '35 min',
      'Statut': 'Nouvelle',
      'Call ID': callId,
      'Durée Appel': callData.duration_ms ? Math.round(callData.duration_ms/1000)+'s' : 'N/A',
      'Date': new Date().toISOString()
    };
    const airtableRes = await axios.post(
      'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + encodeURIComponent(AIRTABLE_TABLE),
      { fields },
      { headers: { 'Authorization': 'Bearer ' + AIRTABLE_API_KEY, 'Content-Type': 'application/json' } }
    );
    console.log('OK:', numeroCommande, airtableRes.data.id);
    res.status(200).json({ status: 'success', order_number: numeroCommande });
  } catch (err) {
    console.error('Error:', (err.response && err.response.data) ? err.response.data : err.message, err.stack);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Ticket impression - inchange
app.get('/ticket/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const response = await axios.get(
      'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + encodeURIComponent(AIRTABLE_TABLE) + '?filterByFormula=FIND("' + orderId + '",{N%C2%B0%20Commande})>0',
      { headers: { 'Authorization': 'Bearer ' + AIRTABLE_API_KEY } }
    );
    if (!response.data.records.length) return res.status(404).send('<h2>Commande introuvable</h2>');
    const f = response.data.records[0].fields;
    const now = new Date().toLocaleString('fr-FR');
    const ticketHtml = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Ticket ' + (f['N° Commande']||'') + '</title><style>body{font-family:"Courier New",monospace;max-width:310px;margin:20px auto;padding:15px;font-size:13px}.center{text-align:center}.bold{font-weight:bold}.large{font-size:18px}.sep{border-top:2px dashed #000;margin:10px 0}.row{display:flex;justify-content:space-between;margin:3px 0}.badge{background:#000;color:#fff;padding:5px 12px;display:inline-block;font-size:16px;margin:5px 0;border-radius:4px;letter-spacing:1px}.detail{background:#f5f5f5;padding:8px;margin:5px 0;white-space:pre-wrap;font-size:12px;border-left:3px solid #000}.total{font-size:20px;font-weight:bold}@media print{.no-print{display:none!important}body{margin:0;max-width:100%}}</style></head><body><div class="center"><div style="font-size:24px">🍕</div><div class="bold large">PIZZA TRATTORIA</div><div class="sep"></div><div class="badge">' + (f['N° Commande']||'') + '</div><div style="font-size:11px">' + now + '</div></div><div class="sep"></div><div class="row"><span class="bold">Client :</span><span>' + (f['Nom Client']||'N/A') + '</span></div><div class="row"><span class="bold">Tél :</span><span>' + (f['Téléphone']||'N/A') + '</span></div><div class="row"><span class="bold">Mode :</span><span class="bold" style="text-transform:uppercase">' + (f['Type']||'N/A') + '</span></div>' + (f['Adresse Livraison'] ? '<div class="row"><span class="bold">Adresse :</span><span>' + f['Adresse Livraison'] + '</span></div>' : '') + '<div class="sep"></div><div class="bold">COMMANDE :</div><div class="detail">' + (f['Détail Commande']||'N/A') + '</div><div class="sep"></div><div class="row"><span class="total">TOTAL :</span><span class="total">' + (f['Montant (€)'] ? parseFloat(f['Montant (€)']).toFixed(2)+' €' : 'N/A') + '</span></div><div class="sep"></div><div class="center"><div class="bold">⏱ Délai : ' + (f['Délai']||'N/A') + '</div><div style="font-size:10px;margin-top:8px">Merci ! Pizza Trattoria 🍕</div></div><div class="sep no-print"></div><div class="center no-print" style="margin:15px 0"><button onclick="window.print()" style="background:#dc2626;color:#fff;border:none;padding:10px 24px;font-size:15px;border-radius:6px;cursor:pointer;font-weight:bold">🖶️ IMPRIMER</button></div></body></html>';
    res.send(ticketHtml);
  } catch(err) {
    res.status(500).send('Erreur: ' + err.message);
  }
});

// API JSON pour le dashboard dynamique
app.get('/api/orders', async (req, res) => {
  try {
    const resp = await axios.get(
      'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + encodeURIComponent(AIRTABLE_TABLE) + '?sort[0][field]=Date&sort[0][direction]=desc&maxRecords=100',
      { headers: { 'Authorization': 'Bearer ' + AIRTABLE_API_KEY } }
    );
    res.json({ records: resp.data.records });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Dashboard responsive et dynamique - le HTML est genere cote serveur une seule fois
app.get('/dashboard', (req, res) => {
  const html = '<!DOCTYPE html>' +
'<html lang="fr">' +
'<head>' +
'<meta charset="UTF-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>🍕 Pizza Trattoria POS</title>' +
'<style>' +
'*{box-sizing:border-box;margin:0;padding:0}' +
'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f9fafb;color:#111827}' +
'.header{background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:100}' +
'.header h1{font-size:18px;white-space:nowrap;flex:1}' +
'.header-sub{font-size:11px;opacity:.8}' +
'.header-right{display:flex;align-items:center;gap:10px}' +
'.container{padding:16px;max-width:1600px;margin:0 auto}' +
'.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}' +
'.card{background:#fff;border-radius:10px;padding:14px 16px;box-shadow:0 1px 4px rgba(0,0,0,.08);border-left:4px solid;transition:.2s}' +
'.card:hover{box-shadow:0 4px 10px rgba(0,0,0,.12)}' +
'.card.red{border-color:#dc2626}.card.blue{border-color:#3b82f6}.card.green{border-color:#22c55e}.card.orange{border-color:#f59e0b}' +
'.card .val{font-size:26px;font-weight:800}' +
'.card .lbl{font-size:11px;color:#6b7280;margin-top:3px}' +
'.table-wrap{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden}' +
'.table-hdr{padding:12px 16px;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}' +
'.table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}' +
'table{width:100%;border-collapse:collapse;min-width:680px}' +
'th{background:#f9fafb;padding:9px 12px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600;white-space:nowrap}' +
'td{padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;vertical-align:middle}' +
'tr:hover td{background:#fef2f2}' +
'tr.annulee td{opacity:.5;text-decoration:line-through}' +
'tr.annulee td:last-child,tr.annulee td:nth-last-child(2){text-decoration:none;opacity:1}' +
'.badge-type{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:bold;color:#fff}' +
'select{border:1px solid;padding:3px 6px;border-radius:4px;font-size:11px;font-weight:bold;background:white;cursor:pointer;transition:.15s;width:100%;min-width:105px}' +
'.btn{background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.4);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;transition:.2s}' +
'.btn:hover{background:rgba(255,255,255,.35)}' +
'.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px;vertical-align:middle}' +
'.dot.green{background:#22c55e;animation:pulse 1.5s infinite}' +
'.dot.red{background:#ef4444}' +
'@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}' +
'.ticket-link{background:#111;color:#fff;padding:3px 9px;text-decoration:none;border-radius:4px;font-size:11px;font-weight:bold}' +
'.empty-row td{text-align:center;padding:36px;color:#9ca3af}' +
'@media(max-width:768px){.header{padding:10px 14px}.header h1{font-size:15px}.container{padding:10px}.stats{grid-template-columns:repeat(2,1fr);gap:8px}.card{padding:10px 12px}.card .val{font-size:22px}}' +
'@media(max-width:480px){.stats{grid-template-columns:1fr 1fr}.card .val{font-size:18px}.header h1{font-size:14px}.header-right{gap:6px}}' +
'</style>' +
'</head>' +
'<body>' +
'<div class="header">' +
'  <span style="font-size:26px">🍕</span>' +
'  <div>' +
'    <h1>Pizza Trattoria — POS</h1>' +
'    <div class="header-sub"><span class="dot green" id="dot"></span><span id="status-txt">En direct</span> — Mise à jour dans <span id="cd">30</span>s</div>' +
'  </div>' +
'  <div class="header-right">' +
'    <button class="btn" onclick="forceRefresh()">↻ Refresh</button>' +
'  </div>' +
'</div>' +
'<div class="container">' +
'  <div class="stats">' +
'    <div class="card red"><div class="val" id="s-total">—</div><div class="lbl">Commandes aujourd'hui</div></div>' +
'    <div class="card blue"><div class="val" id="s-livraison">—</div><div class="lbl">Livraisons</div></div>' +
'    <div class="card green"><div class="val" id="s-emporter">—</div><div class="lbl">À emporter</div></div>' +
'    <div class="card orange"><div class="val" id="s-ca">—</div><div class="lbl">CA du jour (hors annulées)</div></div>' +
'  </div>' +
'  <div class="table-wrap">' +
'    <div class="table-hdr">' +
'      <strong>📋 Commandes (<span id="cnt">...</span>)</strong>' +
'      <span style="font-size:11px;color:#9ca3af">Triées par date ↓</span>' +
'    </div>' +
'    <div class="table-scroll">' +
'      <table><thead><tr>' +
'        <th>N° Commande</th><th>Client</th><th>Téléphone</th><th>Type</th><th>Détail</th><th>Montant</th><th>Statut</th><th>Date</th><th>Ticket</th>' +
'      </tr></thead>' +
'      <tbody id="tbody"><tr class="empty-row"><td colspan="9">Chargement...</td></tr></tbody>' +
'      </table>' +
'    </div>' +
'  </div>' +
'</div>' +
'<script>' +
'var cd = 30;' +
'var cdInterval;' +
'var updating = false;' +
'var COLORS = {Nouvelle:"#3b82f6","En pr\u00e9paration":"#f59e0b","Pr\u00eate":"#8b5cf6","Livr\u00e9e":"#22c55e","Annul\u00e9e":"#ef4444"};' +
'function setText(id, val){ var el = document.getElementById(id); if(el) el.textContent = val; }' +
'function startCountdown(){' +
'  clearInterval(cdInterval);' +
'  cd = 30;' +
'  setText("cd", cd + "s");' +
'  cdInterval = setInterval(function(){' +
'    cd--;' +
'    setText("cd", cd + "s");' +
'    if(cd <= 0){ clearInterval(cdInterval); loadData(); }' +
'  }, 1000);' +
'}' +
'function setStatus(txt, live){' +
'  setText("status-txt", txt);' +
'  var dot = document.getElementById("dot");' +
'  if(dot){ dot.className = live ? "dot green" : "dot red"; }' +
'}' +
'function renderStats(records){' +
'  var today = new Date().toLocaleDateString("fr-FR");' +
'  var todayAll = records.filter(function(r){ return r.fields.Date && new Date(r.fields.Date).toLocaleDateString("fr-FR") === today; });' +
'  var todayValid = todayAll.filter(function(r){ return r.fields.Statut !== "Annul\u00e9e"; });' +
'  var ca = todayValid.reduce(function(s,r){ return s + (r.fields["Montant (\u20ac)"] || 0); }, 0);' +
'  setText("s-total", todayAll.length);' +
'  setText("s-livraison", todayAll.filter(function(r){ return r.fields.Type === "Livraison"; }).length);' +
'  setText("s-emporter", todayAll.filter(function(r){ return r.fields.Type === "Emporter"; }).length);' +
'  setText("s-ca", ca.toFixed(2) + " \u20ac");' +
'  setText("cnt", records.length);' +
'}' +
'function renderRows(records){' +
'  var tbody = document.getElementById("tbody");' +
'  if(!records || !records.length){ tbody.innerHTML = '<tr class="empty-row"><td colspan="9">Aucune commande</td></tr>'; return; }' +
'  var rows = "";' +
'  records.forEach(function(r){' +
'    var f = r.fields;' +
'    var statut = f.Statut || "Nouvelle";' +
'    var color = COLORS[statut] || "#6b7280";' +
'    var tc = f.Type === "Livraison" ? "#f59e0b" : "#10b981";' +
'    var montant = f["Montant (\u20ac)"] != null ? parseFloat(f["Montant (\u20ac)"]).toFixed(2) + " \u20ac" : "N/A";' +
'    var date = f.Date ? new Date(f.Date).toLocaleString("fr-FR") : "N/A";' +
'    var detail = (f["D\u00e9tail Commande"] || "-").substring(0, 80);' +
'    var rowClass = statut === "Annul\u00e9e" ? " class=\"annulee\"" : "";' +
'    var opts = ["Nouvelle","En pr\u00e9paration","Pr\u00eate","Livr\u00e9e","Annul\u00e9e"].map(function(s){' +
'      return "<option value=\"" + s + "\"" + (s === statut ? " selected" : "") + ">" + s + "</option>";' +
'    }).join("");' +
'    var nCmd = (f["N\u00b0 Commande"] || "-");' +
'    rows += "<tr" + rowClass + ">";' +
'    rows += "<td style=\"font-weight:bold;font-family:monospace\">" + nCmd + "</td>";' +
'    rows += "<td>" + (f["Nom Client"] || "-") + "</td>";' +
'    rows += "<td>" + (f["T\u00e9l\u00e9phone"] || "-") + "</td>";' +
'    rows += "<td><span class=\"badge-type\" style=\"background:" + tc + "\">" + (f.Type || "-") + "</span></td>";' +
'    rows += "<td style=\"font-size:11px;max-width:200px\">" + detail + "</td>";' +
'    rows += "<td style=\"font-weight:bold;color:#dc2626\">" + montant + "</td>";' +
'    rows += "<td><select style=\"border-color:" + color + ";color:" + color + "\" onchange=\"updateStatus(\'" + r.id + "\',this)\">" + opts + "</select></td>";' +
'    rows += "<td style=\"font-size:11px;white-space:nowrap\">" + date + "</td>";' +
'    rows += "<td><a class=\"ticket-link\" href=\"/ticket/" + encodeURIComponent(nCmd) + "\" target=\"_blank\">🖶️</a></td>";' +
'    rows += "</tr>";' +
'  });' +
'  tbody.innerHTML = rows;' +
'}' +
'function loadData(){' +
'  if(updating) return;' +
'  updating = true;' +
'  setStatus("Actualisation...", true);' +
'  fetch("/api/orders")' +
'    .then(function(r){ return r.json(); })' +
'    .then(function(data){' +
'      renderRows(data.records || []);' +
'      renderStats(data.records || []);' +
'      setStatus("En direct", true);' +
'      updating = false;' +
'      startCountdown();' +
'    })' +
'    .catch(function(e){' +
'      setStatus("Erreur connexion", false);' +
'      updating = false;' +
'      startCountdown();' +
'    });' +
'}' +
'function forceRefresh(){ clearInterval(cdInterval); loadData(); }' +
'async function updateStatus(recordId, selectEl){' +
'  var status = selectEl.value;' +
'  var color = COLORS[status] || "#6b7280";' +
'  selectEl.style.borderColor = color;' +
'  selectEl.style.color = color;' +
'  var row = selectEl.closest("tr");' +
'  if(row) row.className = (status === "Annul\u00e9e") ? "annulee" : "";' +
'  try{' +
'    await fetch("/update-status", {' +
'      method: "POST",' +
'      headers: {"Content-Type":"application/json"},' +
'      body: JSON.stringify({recordId: recordId, status: status})' +
'    });' +
'    setTimeout(function(){ loadData(); }, 500);' +
'  } catch(e){ console.error(e); }' +
'}' +
'loadData();' +
'</script>' +
'</body></html>';
  res.send(html);
});

// Update statut Airtable
app.post('/update-status', async (req, res) => {
  try {
    const { recordId, status } = req.body;
    await axios.patch(
      'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + encodeURIComponent(AIRTABLE_TABLE) + '/' + recordId,
      { fields: { Statut: status } },
      { headers: { 'Authorization': 'Bearer ' + AIRTABLE_API_KEY, 'Content-Type': 'application/json' } }
    );
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Pizza Trattoria POS', version: '2.1.0' }));

app.listen(PORT, () => console.log('🍕 POS lance sur port', PORT));
