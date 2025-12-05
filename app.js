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

// Provider e Contract
let contract = null;
try {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const abi = ["function mint(address to, uint256 amount) public"];
  contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);
  console.log("Contract caricato");
} catch (err) {
  console.error("Errore contract:", err.message);
}

// DB
let userData = {};
let aggregates = {};

// Spotify
async function getSpotifyToken() {
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64')
      }
    });
    return response.data.access_token;
  } catch (e) {
    console.error("Spotify token errore:", e.message);
    return null;
  }
}

async function getSpotifyLink(item) {
  const token = await getSpotifyToken();
  if (!token) return 'No link';
  try {
    const response = await axios.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent(item)}&type=track&limit=1`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.data.tracks.items[0]?.external_urls.spotify || 'No link';
  } catch (e) {
    return 'No link';
  }
}

// Cron
cron.schedule('0 0 * * 0', () => {
  aggregates = {};
  console.log('Aggregati resettati');
});

// Frame
app.get('/frame', (req, res) => {
  res.set('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html><head><meta property="fc:frame" content="vNext" /><meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Benvenuto+in+High+Fidelity" /><meta property="fc:frame:input:text" content="Categoria (es. songs)" /><meta property="fc:frame:input:text" content="Top 5 separati da virgola (es. song1,song2)" /><meta property="fc:frame:button:1" content="Submit Top 5" /><meta property="fc:frame:button:1:action" content="post" /><meta property="fc:frame:button:1:target" content="https://highfidelity.onrender.com/submit" /><meta property="fc:frame:button:2" content="Daily Check-in" /><meta property="fc:frame:button:2:action" content="post" /><meta property="fc:frame:button:2:target" content="https://highfidelity.onrender.com/checkin" /><meta property="fc:frame:button:3" content="View Top 5" /><meta property="fc:frame:button:3:action" content="post" /><meta property="fc:frame:button:3:target" content="https://highfidelity.onrender.com/view" /><meta property="fc:frame:button:4" content="Share Top 5" /><meta property="fc:frame:button:4:action" content="post" /><meta property="fc:frame:button:4:target" content="https://highfidelity.onrender.com/share" /></head></html>`);
});

// Redirect radice
app.get('/', (req, res) => res.redirect('/frame'));

// Manifest fallback
app.get('/.well-known/farcaster.json', (req, res) => res.json({ isValid: true, messages: [] }));

// Submit
app.post('/submit', async (req, res) => {
  try {
    const { untrustedData } = req.body;
    const fid = untrustedData.fid;
    const inputTexts = untrustedData.inputText ? untrustedData.inputText.split('\n') : ['', ''];
    const category = inputTexts[0]?.trim() || 'songs';
    const listText = inputTexts[1]?.trim() || '';
    const list = listText ? listText.split(',').map(i => i.trim()).filter(Boolean) : [];

    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, { headers: { 'api-key': process.env.NEYNAR_API_KEY } });
    const address = userRes.data.users[0].custody_address;

    userData[fid] = userData[fid] || { lists: {}, address };
    userData[fid].lists[category] = list;

    aggregates[category] = aggregates[category] || {};
    list.forEach(item => aggregates[category][item] = (aggregates[category][item] || 0) + 1);

    if (contract) await contract.mint(address, ethers.parseUnits('10', 18));

    res.send(`<!DOCTYPE html><html><head><meta property="fc:frame" content="vNext" /><meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Successo!+Top+5+Submitted" /><meta property="fc:frame:button:1" content="Back" /><meta property="fc:frame:button:1:action" content="post" /><meta property="fc:frame:button:1:target" content="https://highfidelity.onrender.com/frame" /></head></html>`);
  } catch (e) {
    console.error('Submit errore:', e.message);
    res.send(`<!DOCTYPE html><html><head><meta property="fc:frame" content="vNext" /><meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Errore" /></head></html>`);
  }
});

// Aggiungi le altre routes allo stesso modo (checkin, view, share) – se vuoi il codice completo per loro, dimmi.

app.listen(port, () => console.log(`Server on port ${port}`));
