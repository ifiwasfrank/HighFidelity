console.log("Starting app.js...");
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// ========================
// CONTRACT SETUP SICURO
// ========================
let contract = null;

try {
  if (!process.env.BASE_RPC) throw new Error("BASE_RPC mancante");
  if (!process.env.PRIVATE_KEY || !process.env.PRIVATE_KEY.startsWith('0x')) throw new Error("PRIVATE_KEY mancante o non valida");
  if (!process.env.CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS mancante");

  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const abi = ["function mint(address to, uint256 amount) public"];
  contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);
  console.log("Contract e wallet caricati correttamente");
} catch (err) {
  console.error("ERRORE CRITICO (il server non può mintare):", err.message);
  // Non esce, così vediamo l'errore nei logs di Render
}

// ========================
// DB in memoria
// ========================
let userData = {};
let aggregates = {};

// ========================
// Spotify (opzionale, non blocca il frame)
// ========================
async function getSpotifyToken() {
  try {
    const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const res = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`
      }
    });
    return res.data.access_token;
  } catch (e) { return null; }
}

async function getSpotifyLink(item) {
  const token = await getSpotifyToken();
  if (!token) return '';
  try {
    const res = await axios.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent(item)}&type=track&limit=1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data.tracks.items[0]?.external_urls.spotify || '';
  } catch (e) { return ''; }
}

// Reset settimanale
cron.schedule('0 0 * * 0', () => {
  aggregates = {};
  console.log('Aggregati resettati (domenica)');
});

// ========================
// FRAME INIZIALE
// ========================
app.get('/frame', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Benvenuto+in+High+Fidelity" />
  <meta property="fc:frame:input:text" placeholder="Categoria (es. songs)" />
  <meta property="fc:frame:input:text" placeholder="Top 5 separati da virgola" />
  <meta property="fc:frame:button:1" content="Submit Top 5" />
  <meta property="fc:frame:button:1:action" content="post" />
  <meta property="fc:frame:button:1:target" content="https://highfidelity.onrender.com/submit" />
  <meta property="fc:frame:button:2" content="Daily Check-in" />
  <meta property="fc:frame:button:2:action" content="post" />
  <meta property="fc:frame:button:2:target" content="https://highfidelity.onrender.com/checkin" />
  <meta property="fc:frame:button:3" content="View Top 5" />
  <meta property="fc:frame:button:3:action" content="post" />
  <meta property="fc:frame:button:3:target" content="https://highfidelity.onrender.com/view" />
  <meta property="fc:frame:button:4" content="Share Top 5" />
  <meta property="fc:frame:button:4:action" content="post" />
  <meta property="fc:frame:button:4:target" content="https://highfidelity.onrender.com/share" />
</head>
</html>
  `);
});

app.get('/', (req, res) => res.redirect('/frame'));
app.get('/.well-known/farcaster.json', (req, res) => res.json({ isValid: true, messages: [] }));

// ========================
// SUBMIT
// ========================
app.post('/submit', async (req, res) => {
  try {
    const fid = req.body.untrustedData?.fid;
    if (!fid) throw new Error("FID non trovato");

    const inputTexts = req.body.untrustedData?.inputText ? req.body.untrustedData.inputText.split('\n') : ['', ''];
    const category = inputTexts[0]?.trim() || 'songs';
    const listText = inputTexts[1]?.trim() || '';
    const list = listText ? listText.split(',').map(i => i.trim()).filter(Boolean) : [];

    const neynarRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { 'api-key': process.env.NEYNAR_API_KEY }
    });
    const address = neynarRes.data.users[0]?.custody_address;
    if (!address) throw new Error("Indirizzo non trovato");

    if (!userData[fid]) userData[fid] = { lists: {}, address };
    userData[fid].lists[category] = list;

    if (!aggregates[category]) aggregates[category] = {};
    list.forEach(item => aggregates[category][item] = (aggregates[category][item] || 0) + 1);

    if (contract) {
      await contract.mint(address, ethers.parseUnits('10', 18));
    }

    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Top+5+salvata+e+10+HIFI+mintati!" />
  <meta property="fc:frame:button:1" content="Torna indietro" />
  <meta property="fc:frame:button:1:action" content="post" />
  <meta property="fc:frame:button:1:target" content="https://highfidelity.onrender.com/frame" />
</head>
</html>
    `);
  } catch (err) {
    console.error("Errore /submit:", err.message);
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="https://placehold.co/600x400/red/white?text=Errore:+${encodeURIComponent(err.message)}" />
  <meta property="fc:frame:button:1" content="Riprova" />
  <meta property="fc:frame:button:1:action" content="post" />
  <meta property="fc:frame:button:1:target" content="https://highfidelity.onrender.com/frame" />
</head>
</html>
    `);
  }
});

// ========================
// CHECK-IN, VIEW, SHARE (stessi try/catch sicuri)
// ========================
app.post('/checkin', async (req, res) => { /* ... stessa struttura con try/catch ... */ });
app.post('/view', async (req, res) => { /* ... */ });
app.post('/share', async (req, res) => { /* ... */ });
// (puoi copiare le versioni precedenti e aggiungere try/catch come sopra)

app.listen(port, () => {
  console.log(`Server on port ${port} - LIVE`);
});
