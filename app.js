console.log("High Fidelity starting...");
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// =================================
// CONTRACT
// =================================
let contract = null;
try {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const abi = ["function mint(address to, uint256 amount) public"];
  contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);
  console.log("Contract loaded OK");
} catch (err) {
  console.error("Contract error:", err.message);
}

// =================================
// DB IN MEMORIA
// =================================
let userData = {};
let aggregates = {};

// =================================
// MANIFEST (con accountAssociation)
// Sostituisci header, payload, signature con i tuoi valori
// =================================
app.get('/.well-known/farcaster.json', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.json({
    "accountAssociation": {
      "header": "eyJmaWQiOjIxNDAyNSwidHlwZSI6ImN1c3RvZHkiLCJrZXkiOiIweDNjMTYyRTEzYzQzQjYwYUEwZTU0ZTFiMTlCZWRlYjVEYTFkODg0RTMifQ",     // ← Sostituisci
      "payload": "eyJkb21haW4iOiJoaWdoLWZpZGVsaXR5LXNpeC52ZXJjZWwuYXBwIn0",   // ← Sostituisci
      "signature": "zQif1h5EYJhw/qMespLncCPAmjkORbWVx0gtkM+yJt8eF+St4hBu+Hjb+4waBCK6YWpXnFJWPzjAaa0G9quU9hw=" // ← Sostituisci
    },
    "miniapp": {
      "version": "1",
      "name": "High Fidelity",
      "description": "Top 5 musicali con mint $HIFI",
      "iconUrl": "https://placehold.co/512x512/png?text=HIFI",
      "splashImageUrl": "https://placehold.co/1200x630/png?text=High+Fidelity",
      "homeUrl": "https://high-fidelity-six.vercel.app/frame",
      "imageUrl": "https://placehold.co/1200x630/png?text=High+Fidelity",
      "tags": ["music", "top5", "hifi"],
      "primaryCategory": "entertainment",
      "subtitle": "Classifiche musicali",
      "buttonTitle": "Apri High Fidelity"
    },
    "baseBuilder": {
      "ownerAddress": "0x3f64c8bd049adeba075b4108c590294d186ecec6" // tuo wallet minter
    }
  });
});

// =================================
// FRAME PRINCIPALE (Mini App)
// =================================
app.get('/frame', (req, res) => {
  console.log('Frame requested');
  res.set('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>High Fidelity</title>
  <meta property="og:title" content="High Fidelity">
  <meta property="og:description" content="Top 5 musicali con $HIFI">
  <meta property="og:image" content="https://placehold.co/1200x630/png?text=High+Fidelity">
  <meta property="fc:frame" content="vNext">
  <meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Benvenuto+in+High+Fidelity">
  <meta property="fc:frame:input:text" content="Categoria (es. songs)">
  <meta property="fc:frame:input:text" content="Top 5 separati da virgola">
  <meta property="fc:frame:button:1" content="Submit Top 5">
  <meta property="fc:frame:button:1:action" content="post">
  <meta property="fc:frame:button:1:target" content="https://high-fidelity-six.vercel.app/submit">
  <meta property="fc:frame:button:2" content="Daily Check-in">
  <meta property="fc:frame:button:2:action" content="post">
  <meta property="fc:frame:button:2:target" content="https://high-fidelity-six.vercel.app/checkin">
  <meta property="fc:frame:button:3" content="View Top 5">
  <meta property="fc:frame:button:3:action" content="post">
  <meta property="fc:frame:button:3:target" content="https://high-fidelity-six.vercel.app/view">
  <meta property="fc:frame:button:4" content="Share Top 5">
  <meta property="fc:frame:button:4:action" content="post">
  <meta property="fc:frame:button:4:target" content="https://high-fidelity-six.vercel.app/share">
</head>
<body></body>
</html>
  `.trim());
});

app.get('/', (req, res) => res.redirect('/frame'));

// =================================
// SUBMIT
// =================================
app.post('/submit', async (req, res) => {
  try {
    const { untrustedData } = req.body;
    const fid = untrustedData.fid;
    const inputTexts = untrustedData.inputText ? untrustedData.inputText.split('\n') : ['', ''];
    const category = inputTexts[0]?.trim() || 'songs';
    const list = inputTexts[1]?.trim() ? inputTexts[1].split(',').map(i => i.trim()).filter(Boolean) : [];

    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { 'api-key': process.env.NEYNAR_API_KEY }
    });
    const address = userRes.data.users[0].custody_address;

    userData[fid] = userData[fid] || { lists: {}, address };
    userData[fid].lists[category] = list;

    aggregates[category] = aggregates[category] || {};
    list.forEach(item => aggregates[category][item] = (aggregates[category][item] || 0) + 1);

    if (contract) await contract.mint(address, ethers.parseUnits('10', 18));

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta property="fc:frame" content="vNext">
  <meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Top+5+salvata!+10+HIFI+mintati">
  <meta property="fc:frame:button:1" content="Back">
  <meta property="fc:frame:button:1:action" content="post">
  <meta property="fc:frame:button:1:target" content="https://high-fidelity-six.vercel.app/frame">
</head>
<body></body>
</html>
    `.trim());
  } catch (e) {
    console.error("Submit error:", e.message);
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta property="fc:frame" content="vNext">
  <meta property="fc:frame:image" content="https://placehold.co/600x400/red/white/png?text=Errore">
  <meta property="fc:frame:button:1" content="Back">
  <meta property="fc:frame:button:1:action" content="post">
  <meta property="fc:frame:button:1:target" content="https://high-fidelity-six.vercel.app/frame">
</head>
<body></body>
</html>
    `.trim());
  }
});

// Check-in
app.post('/checkin', async (req, res) => {
  try {
    const { untrustedData } = req.body;
    const fid = untrustedData.fid;
    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { 'api-key': process.env.NEYNAR_API_KEY }
    });
    const address = userRes.data.users[0].custody_address;

    const now = Date.now();
    if (userData[fid]?.lastCheckin && now - userData[fid].lastCheckin < 86400000) {
      res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta property="fc:frame" content="vNext">
  <meta property="fc:frame:image" content="https://placehold.co/600x400/orange/white/png?text=Già+fatto+oggi">
  <meta property="fc:frame:button:1" content="Back">
  <meta property="fc:frame:button:1:action" content="post">
  <meta property="fc:frame:button:1:target" content="https://high-fidelity-six.vercel.app/frame">
</head>
<body></body>
</html>
      `.trim());
      return;
    }

    userData[fid] = userData[fid] || { address };
    userData[fid].lastCheckin = now;

    if (contract) await contract.mint(address, ethers.parseUnits('5', 18));

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta property="fc:frame" content="vNext">
  <meta property="fc:frame:image" content="https://placehold.co/600x400/green/white/png?text=Check-in+OK!+5+HIFI+mintati">
  <meta property="fc:frame:button:1" content="Back">
  <meta property="fc:frame:button:1:action" content="post">
  <meta property="fc:frame:button:1:target" content="https://high-fidelity-six.vercel.app/frame">
</head>
<body></body>
</html>
    `.trim());
  } catch (e) {
    console.error("Check-in error:", e.message);
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta property="fc:frame" content="vNext">
  <meta property="fc:frame:image" content="https://placehold.co/600x400/red/white/png?text=Errore">
  <meta property="fc:frame:button:1" content="Back">
  <meta property="fc:frame:button:1:action" content="post">
  <meta property="fc:frame:button:1:target" content="https://high-fidelity-six.vercel.app/frame">
</head>
<body></body>
</html>
    `.trim());
  }
});

// View e Share (aggiungi con lo stesso formato)

app.listen(port, () => console.log(`Server live on port ${port}`));
