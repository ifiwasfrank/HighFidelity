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

// Provider e Contract (con ABI semplificato per mint)
const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contractAddress = process.env.CONTRACT_ADDRESS;
const abi = [
  "function mint(address to, uint256 amount) public"
];
const contract = new ethers.Contract(contractAddress, abi, wallet);

// DB in memoria (usa Mongo in prod)
let userData = {}; // { fid: { lists: {category: ['item1',...]}, lastCheckin: timestamp, address: '0x...', lastShare: timestamp } }
let aggregates = {}; // { category: { item: count } }

// Spotify Token
async function getSpotifyToken() {
  const response = await axios.post('https://accounts.spotify.com/api/token', 
    'grant_type=client_credentials', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64')
      }
  });
  return response.data.access_token;
}

// Spotify Link
async function getSpotifyLink(item) {
  const token = await getSpotifyToken();
  const response = await axios.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent(item)}&type=track&limit=1`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.data.tracks.items[0]?.external_urls.spotify || 'No link found';
}

// Cron reset aggregati (domenica)
cron.schedule('0 0 * * 0', () => {
  aggregates = {};
  console.log('Aggregati resettati!');
});

// Frame Iniziale
app.get('/frame', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta property="fc:frame" content="vNext" />
      <meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Benvenuto+in+High+Fidelity" /> <!-- Placeholder benvenuto -->
      <meta property="fc:frame:input:text" content="Categoria (es. songs)" />
      <meta property="fc:frame:input:text" content="Top 5 separati da virgola (es. song1,song2)" />
      <meta property="fc:frame:button:1" content="Submit Top 5" />
      <meta property="fc:frame:button:1:action" content="post" />
      <meta property="fc:frame:button:1:target" content="https://highfidelity.onrender.com/submit" /> <!-- Cambia con ngrok/Vercel URL -->
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

// Route per la radice – reindirizza automaticamente al Frame
app.get('/', (req, res) => {
  res.redirect('/frame');
});

// Submit Top 5
app.post('/submit', async (req, res) => {
  const { untrustedData } = req.body;
  const fid = untrustedData.fid;

  // FIX: gestione sicura degli input
  const inputTexts = untrustedData.inputText ? untrustedData.inputText.split('\n') : ['', ''];
  const category = inputTexts[0]?.trim() || 'songs';
  const listText = inputTexts[1]?.trim() || '';
  const list = listText ? listText.split(',').map(i => i.trim()).filter(Boolean) : [];

  const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
    headers: { 'api-key': process.env.NEYNAR_API_KEY }
  });
  const address = userRes.data.users[0].custody_address;

  if (!userData[fid]) userData[fid] = { lists: {}, address };
  userData[fid].lists[category] = list;

  if (!aggregates[category]) aggregates[category] = {};
  list.forEach(item => aggregates[category][item] = (aggregates[category][item] || 0) + 1);

  await contract.mint(address, ethers.parseUnits('10', 18)); // 10 HIFI

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta property="fc:frame" content="vNext" />
      <meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Successo!+Top+5+Submitted" /> <!-- Placeholder successo -->
      <meta property="fc:frame:button:1" content="Back" />
      <meta property="fc:frame:button:1:action" content="post" />
      <meta property="fc:frame:button:1:target" content="https://highfidelity.onrender.com/frame" />
    </head>
    </html>
  `);
});

// Check-in
app.post('/checkin', async (req, res) => {
  const { untrustedData } = req.body;
  const fid = untrustedData.fid;
  const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
    headers: { 'api-key': process.env.NEYNAR_API_KEY }
  });
  const address = userRes.data.users[0].custody_address;

  const now = Date.now();
  if (userData[fid]?.lastCheckin && now - userData[fid].lastCheckin < 86400000) {
    res.send(`<!-- Frame errore -->`); // Placeholder immagine errore
  } else {
    if (!userData[fid]) userData[fid] = { address };
    userData[fid].lastCheckin = now;
    await contract.mint(address, ethers.parseUnits('5', 18)); // 5 HIFI
    res.send(`<!-- Frame successo -->`); // Placeholder
  }
});

// View Top 5
app.post('/view', async (req, res) => {
  const category = 'songs'; // O da input
  const top5 = Object.entries(aggregates[category] || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([item]) => item);

  const links = await Promise.all(top5.map(getSpotifyLink));
  const topWithLinks = top5.map((item, i) => `${item} - Ascolta: ${links[i]}`);

  const imageUrl = `https://placehold.co/600x400/png?text=Top+5:${topWithLinks.join(',')}`; // Placeholder dynamic

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta property="fc:frame" content="vNext" />
      <meta property="fc:frame:image" content="${imageUrl}" />
      <meta property="fc:frame:button:1" content="Back" />
      <meta property="fc:frame:button:1:action" content="post" />
      <meta property="fc:frame:button:1:target" content="https://highfidelity.onrender.com/frame" />
    </head>
    </html>
  `);
});

// Share Top 5 (nuovo)
app.post('/share', async (req, res) => {
  const { untrustedData } = req.body;
  const fid = untrustedData.fid;
  const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
    headers: { 'api-key': process.env.NEYNAR_API_KEY }
  });
  const address = userRes.data.users[0].custody_address;

  const now = Date.now();
  if (userData[fid]?.lastShare && now - userData[fid].lastShare < 86400000) {
    res.send(`<!-- Frame errore share -->`); // Placeholder
  } else {
    if (!userData[fid]) userData[fid] = { address };
    userData[fid].lastShare = now;
    await contract.mint(address, ethers.parseUnits('10', 18)); // 10 HIFI per share

    // Genera post Farcaster (es. text con top 5)
    const category = 'songs';
    const list = userData[fid].lists[category] || ['No list'];
    const shareText = `La mia Top 5 ${category}: ${list.join(', ')} #HighFidelity`;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta property="fc:frame" content="vNext" />
        <meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Shared+Success" />
        <meta property="fc:frame:post_url" content="https://highfidelity.onrender.com/frame" /> <!-- Back -->
        <meta property="fc:frame:button:1" content="Post on Farcaster" />
        <meta property="fc:frame:button:1:action" content="post" />
        <meta property="fc:frame:button:1:target" content="https://warpcast.com/~/compose?text=${encodeURIComponent(shareText)}" /> <!-- Genera cast -->
        <meta property="fc:frame:button:2" content="Share on X" />
        <meta property="fc:frame:button:2:action" content="link" />
        <meta property="fc:frame:button:2:target" content="https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}" /> <!-- Link a X -->
      </head>
      </html>
    `);
  }
});
app.get('/.well-known/farcaster.json', (req, res) => {
  res.json({
    "isValid": true,
    "messages": []
  });
});
app.listen(port, () => console.log(`Server on port ${port}`));
