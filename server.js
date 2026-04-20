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
  const s = String(val).toLowerCase().trim().replace(/[\u00e9\u00e8\u00ea]/g, 'e');
  return ['oui','yes','y','true','ok','1','confirmee','confirme','validee','valide'].includes(s);
}

app.post('/webhook/retell', async (req, res) => {
  try {
    const event = req.body || {};
    const callData = event.call || event.data || {};
    const eventType = event.event || event.event_type || '';
    const callId = callData.call_id || event.call_id || 'unknown';
    if (eventType !== 'call_analyzed') return res.status(200).json({ status: 'ignored', event: eventType });
    const custom = (callData.call_analysis && callData.call_analysis.custom_analysis_data) ? callData.call_analysis.custom_analysis_data : {};
    if (!isConfirmed(custom.commande_confirmee)) return res.status(200).json({ status: 'ignored', reason: 'non_confirmee' });
    const numeroCommande = generateOrderNumber();
    const type = (custom.type_commande || 'emporter').toString().toLowerCase();
    const fields = {
      'N\u00b0 Commande': numeroCommande, 'Nom Client': custom.nom_client || 'Inconnu',
      'T\u00e9l\u00e9phone': custom.telephone_client || callData.from_number || 'N/A',
      'Type': type.charAt(0).toUpperCase() + type.slice(1),
      'Adresse Livraison': custom.adresse_livraison || '',
      'D\u00e9tail Commande': custom.detail_commande || (callData.call_analysis && callData.call_analysis.call_summary) || '',
      'Montant (\u20ac)': parseFloat(String(custom.montant_total).replace(',', '.')) || 0,
      'D\u00e9lai': type === 'livraison' ? '50 min' : '35 min',
      'Statut': 'Nouvelle', 'Call ID': callId,
      'Dur\u00e9e Appel': callData.duration_ms ? Math.round(callData.duration_ms/1000)+'s' : 'N/A',
      'Date': new Date().toISOString()
    };
    const r = await axios.post('https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + encodeURIComponent(AIRTABLE_TABLE), { fields }, { headers: { 'Authorization': 'Bearer ' + AIRTABLE_API_KEY, 'Content-Type': 'application/json' } });
    res.status(200).json({ status: 'success', order_number: numeroCommande });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/ticket/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const response = await axios.get('https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + encodeURIComponent(AIRTABLE_TABLE) + '?filterByFormula=FIND("' + orderId + '",{N%C2%B0%20Commande})>0', { headers: { 'Authorization': 'Bearer ' + AIRTABLE_API_KEY } });
    if (!response.data.records.length) return res.status(404).send('<h2>Commande introuvable</h2>');
    const f = response.data.records[0].fields;
    const nCmd = f['N\u00b0 Commande'] || '';
    const montant = f['Montant (\u20ac)'] != null ? parseFloat(f['Montant (\u20ac)']).toFixed(2) + ' \u20ac' : 'N/A';
    res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ticket</title>'
      + '<style>body{font-family:monospace;max-width:310px;margin:20px auto;padding:15px;font-size:13px}'
      + '.c{text-align:center}.b{font-weight:bold}.s{border-top:2px dashed #000;margin:10px 0}'
      + '.r{display:flex;justify-content:space-between;margin:3px 0}'
      + '.bg{background:#000;color:#fff;padding:5px 12px;border-radius:4px;display:inline-block}'
      + '.t{font-size:20px;font-weight:bold}@media print{.np{display:none}body{margin:0}}'
      + '</style></head><body>'
      + '<div class="c"><div style="font-size:24px">&#127829;</div>'
      + '<div class="b" style="font-size:18px">PIZZA TRATTORIA</div>'
      + '<div class="s"></div><div class="bg">' + nCmd + '</div>'
      + '<div style="font-size:11px">' + new Date().toLocaleString('fr-FR') + '</div></div>'
      + '<div class="s"></div>'
      + '<div class="r"><span class="b">Client:</span><span>' + (f['Nom Client']||'N/A') + '</span></div>'
      + '<div class="r"><span class="b">Tel:</span><span>' + (f['T\u00e9l\u00e9phone']||'N/A') + '</span></div>'
      + '<div class="r"><span class="b">Mode:</span><span>' + (f['Type']||'N/A') + '</span></div>'
      + (f['Adresse Livraison'] ? '<div class="r"><span class="b">Adresse:</span><span>' + f['Adresse Livraison'] + '</span></div>' : '')
      + '<div class="s"></div><div class="b">COMMANDE:</div>'
      + '<div style="background:#f5f5f5;padding:8px;white-space:pre-wrap;font-size:12px">' + (f['D\u00e9tail Commande']||'N/A') + '</div>'
      + '<div class="s"></div>'
      + '<div class="r"><span class="t">TOTAL:</span><span class="t">' + montant + '</span></div>'
      + '<div class="s"></div><div class="c"><div class="b">Delai: ' + (f['D\u00e9lai']||'N/A') + '</div></div>'
      + '<div class="s np"></div><div class="c np" style="margin:15px 0">'
      + '<button onclick="window.print()" style="background:#dc2626;color:#fff;border:none;padding:10px 24px;font-size:15px;border-radius:6px;cursor:pointer">IMPRIMER</button>'
      + '</div></body></html>');
  } catch(err) { res.status(500).send('Erreur: ' + err.message); }
});

app.get('/api/orders', async (req, res) => {
  try {
    const r = await axios.get('https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + encodeURIComponent(AIRTABLE_TABLE) + '?sort[0][field]=Date&sort[0][direction]=desc&maxRecords=100', { headers: { 'Authorization': 'Bearer ' + AIRTABLE_API_KEY } });
    res.json({ records: r.data.records });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Dashboard JS - stored as a Node.js variable, no escaping issues
const DASHBOARD_JS = `
var cd=30,cdi,upd=false;
var COLORS={"Nouvelle":"#3b82f6","En pr\u00e9paration":"#f59e0b","Pr\u00eate":"#8b5cf6","Livr\u00e9e":"#22c55e","Annul\u00e9e":"#ef4444"};
var STATUTS=["Nouvelle","En pr\u00e9paration","Pr\u00eate","Livr\u00e9e","Annul\u00e9e"];
function _(id){return document.getElementById(id);}
function setText(id,v){var e=_(id);if(e)e.textContent=v;}
function setDot(ok){var d=_("dot");if(d)d.className=ok?"dot g":"dot r";}
function setStatus(t,ok){setText("stxt",t);setDot(ok);}
function startCD(){
  clearInterval(cdi);cd=30;setText("cd","30s");
  cdi=setInterval(function(){cd--;setText("cd",cd+"s");if(cd<=0){clearInterval(cdi);load();}},1000);
}
function calcStats(rec){
  var td=new Date().toLocaleDateString("fr-FR");
  var ta=rec.filter(function(r){return r.fields.Date&&new Date(r.fields.Date).toLocaleDateString("fr-FR")===td;});
  var tv=ta.filter(function(r){var s=r.fields.Statut||"";return s.indexOf("nnul")===-1;});
  var ca=tv.reduce(function(s,r){return s+(r.fields["Montant (\u20ac)"]||0);},0);
  setText("st",ta.length);
  setText("sl",ta.filter(function(r){return r.fields.Type==="Livraison";}).length);
  setText("se",ta.filter(function(r){return r.fields.Type==="Emporter";}).length);
  setText("sc",ca.toFixed(2)+" \u20ac");
  setText("cnt",rec.length);
}
function makeRow(r){
  var f=r.fields,st=f.Statut||"Nouvelle",rid=r.id;
  var cl=COLORS[st]||"#6b7280";
  var tc=f.Type==="Livraison"?"#f59e0b":"#10b981";
  var mo=f["Montant (\u20ac)"]!=null?parseFloat(f["Montant (\u20ac)"]).toFixed(2)+" \u20ac":"N/A";
  var dt=f.Date?new Date(f.Date).toLocaleString("fr-FR"):"N/A";
  var det=(f["D\u00e9tail Commande"]||"-").substring(0,80);
  var nc=f["N\u00b0 Commande"]||"-";
  var isAnn=(st.indexOf("nnul")!==-1);
  var tr=document.createElement("tr");
  if(isAnn)tr.className="ann";
  function makeTd(txt,style){var c=document.createElement("td");if(style)c.style.cssText=style;c.textContent=txt;return c;}
  tr.appendChild(makeTd(nc,"font-weight:bold;font-family:monospace"));
  tr.appendChild(makeTd(f["Nom Client"]||"-"));
  tr.appendChild(makeTd(f["T\u00e9l\u00e9phone"]||"-"));
  var tdType=document.createElement("td");
  var sp=document.createElement("span");sp.className="badge";sp.style.background=tc;sp.textContent=f.Type||"-";
  tdType.appendChild(sp);tr.appendChild(tdType);
  tr.appendChild(makeTd(det,"font-size:11px;max-width:200px"));
  tr.appendChild(makeTd(mo,"font-weight:bold;color:#dc2626"));
  var tdSel=document.createElement("td");
  var sel=document.createElement("select");
  sel.style.borderColor=cl;sel.style.color=cl;
  STATUTS.forEach(function(sx){
    var opt=document.createElement("option");
    opt.value=sx;opt.textContent=sx;
    if(sx===st)opt.selected=true;
    sel.appendChild(opt);
  });
  (function(rid2){sel.addEventListener("change",function(){updateSt(rid2,this);});})(rid);
  tdSel.appendChild(sel);tr.appendChild(tdSel);
  tr.appendChild(makeTd(dt,"font-size:11px;white-space:nowrap"));
  var tdLink=document.createElement("td");
  var a=document.createElement("a");a.className="tlink";a.href="/ticket/"+encodeURIComponent(nc);a.target="_blank";a.textContent="Ticket";
  tdLink.appendChild(a);tr.appendChild(tdLink);
  return tr;
}
function buildTable(rec){
  var tb=_("tb");
  while(tb.firstChild)tb.removeChild(tb.firstChild);
  if(!rec||!rec.length){
    var tr=document.createElement("tr");tr.className="empty";
    var td=document.createElement("td");td.colSpan=9;td.textContent="Aucune commande";
    tr.appendChild(td);tb.appendChild(tr);return;
  }
  var frag=document.createDocumentFragment();
  for(var i=0;i<rec.length;i++)frag.appendChild(makeRow(rec[i]));
  tb.appendChild(frag);
}
function load(){
  if(upd)return;upd=true;setStatus("Actualisation...",true);
  fetch("/api/orders").then(function(r){return r.json();}).then(function(d){
    buildTable(d.records||[]);calcStats(d.records||[]);setStatus("En direct",true);upd=false;startCD();
  }).catch(function(){setStatus("Erreur",false);upd=false;startCD();});
}
function forceRefresh(){clearInterval(cdi);load();}
function updateSt(rid,sel){
  var s=sel.value,c=COLORS[s]||"#6b7280";
  sel.style.borderColor=c;sel.style.color=c;
  var row=sel.closest("tr");
  if(row)row.className=s.indexOf("nnul")!==-1?"ann":"";
  fetch("/update-status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({recordId:rid,status:s})})
    .then(function(){setTimeout(load,400);})
    .catch(function(e){console.error(e);});
}
load();
`;

app.get('/dashboard', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Pizza Trattoria POS</title>'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f9fafb;color:#111827}'
    + '.hdr{background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:100}'
    + '.hdr h1{font-size:18px;flex:1}.hsub{font-size:11px;opacity:.8}'
    + '.box{padding:16px;max-width:1600px;margin:0 auto}'
    + '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}'
    + '.card{background:#fff;border-radius:10px;padding:14px 16px;box-shadow:0 1px 4px rgba(0,0,0,.08);border-left:4px solid;transition:.2s}'
    + '.card:hover{box-shadow:0 4px 10px rgba(0,0,0,.12)}'
    + '.card.red{border-color:#dc2626}.card.blue{border-color:#3b82f6}.card.green{border-color:#22c55e}.card.orange{border-color:#f59e0b}'
    + '.card .val{font-size:26px;font-weight:800}.card .lbl{font-size:11px;color:#6b7280;margin-top:3px}'
    + '.panel{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden}'
    + '.phead{padding:12px 16px;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}'
    + '.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}'
    + 'table{width:100%;border-collapse:collapse;min-width:650px}'
    + 'th{background:#f9fafb;padding:9px 12px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600;white-space:nowrap}'
    + 'td{padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;vertical-align:middle}'
    + 'tr:hover td{background:#fef2f2}'
    + 'tr.ann td{opacity:.5;text-decoration:line-through}tr.ann td:last-child,tr.ann td:nth-last-child(2){text-decoration:none;opacity:1}'
    + '.badge{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:bold;color:#fff}'
    + 'select{border:1px solid;padding:3px 6px;border-radius:4px;font-size:11px;font-weight:bold;background:white;cursor:pointer;width:100%;min-width:105px}'
    + '.btn{background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.4);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px}'
    + '.btn:hover{background:rgba(255,255,255,.35)}'
    + '.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px;vertical-align:middle}'
    + '.dot.g{background:#22c55e;animation:blink 1.5s infinite}.dot.r{background:#ef4444}'
    + '@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}'
    + '.tlink{background:#111;color:#fff;padding:3px 9px;text-decoration:none;border-radius:4px;font-size:11px;font-weight:bold}'
    + '.empty td{text-align:center;padding:36px;color:#9ca3af}'
    + '@media(max-width:768px){.hdr{padding:10px 14px}.hdr h1{font-size:15px}.box{padding:10px}.stats{grid-template-columns:repeat(2,1fr);gap:8px}.card{padding:10px 12px}.card .val{font-size:22px}}'
    + '@media(max-width:480px){.stats{grid-template-columns:1fr 1fr}.card .val{font-size:18px}.hdr h1{font-size:14px}}'
    + '</style></head><body>'
    + '<div class="hdr"><span style="font-size:26px">&#127829;</span>'
    + '<div><h1>Pizza Trattoria &#8212; POS</h1>'
    + '<div class="hsub"><span class="dot g" id="dot"></span><span id="stxt">En direct</span> &#8212; MAJ dans <span id="cd">30</span>s</div></div>'
    + '<div style="margin-left:auto"><button class="btn" onclick="forceRefresh()">&#8635; Refresh</button></div></div>'
    + '<div class="box"><div class="stats">'
    + '<div class="card red"><div class="val" id="st">&#8212;</div><div class="lbl">Commandes aujourd&#39;hui</div></div>'
    + '<div class="card blue"><div class="val" id="sl">&#8212;</div><div class="lbl">Livraisons</div></div>'
    + '<div class="card green"><div class="val" id="se">&#8212;</div><div class="lbl">A emporter</div></div>'
    + '<div class="card orange"><div class="val" id="sc">&#8212;</div><div class="lbl">CA du jour (hors annul&#233;es)</div></div>'
    + '</div><div class="panel">'
    + '<div class="phead"><strong>Commandes (<span id="cnt">...</span>)</strong><span style="font-size:11px;color:#9ca3af">Par date</span></div>'
    + '<div class="scroll"><table><thead><tr>'
    + '<th>N&#176;</th><th>Client</th><th>T&#233;l</th><th>Type</th><th>D&#233;tail</th><th>Montant</th><th>Statut</th><th>Date</th><th>Ticket</th>'
    + '</tr></thead><tbody id="tb"><tr class="empty"><td colspan="9">Chargement...</td></tr></tbody></table></div>'
    + '</div></div>'
    + '<script>' + DASHBOARD_JS + '<' + '/script>'
    + '</body></html>');
});

app.post('/update-status', async (req, res) => {
  try {
    const { recordId, status } = req.body;
    await axios.patch('https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + encodeURIComponent(AIRTABLE_TABLE) + '/' + recordId, { fields: { Statut: status } }, { headers: { 'Authorization': 'Bearer ' + AIRTABLE_API_KEY, 'Content-Type': 'application/json' } });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Pizza Trattoria POS', version: '2.5.0' }));
app.listen(PORT, () => console.log('POS on port', PORT));
