console.log("High Fidelity Mini App starting...");
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
} catch (e) {
  console.error("Wallet/Contract error:", e.message);
}

// =================================
// DB IN MEMORIA
// =================================
const userData = {};
const aggregates = {};

// =================================
// MANIFEST (per validazione Mini App)
// =================================
app.get('/.well-known/farcaster.json', (req, res) => {
  res.json({
    "accountAssociation": {
      "header": process.env.ASSOCIATION_HEADER || "eyJmaWQiOjIxNDAyNSwidHlwZSI6ImN1c3RvZHkiLCJrZXkiOiIweDNjMTYyRTEzYzQzQjYwYUEwZTU0ZTFiMTlCZWRlYjVEYTFkODg0RTMifQ",
      "payload": process.env.ASSOCIATION_PAYLOAD || "eyJkb21haW4iOiJoaWdoLWZpZGVsaXR5LXNpeC52ZXJjZWwuYXBwIn0",
      "signature": process.env.ASSOCIATION_SIGNATURE || "zQif1h5EYJhw/qMespLncCPAmjkORbWVx0gtkM+yJt8eF+St4hBu+Hjb+4waBCK6YWpXnFJWPzjAaa0G9quU9hw="
    },
    "miniapp": {
      "version": "1",
      "name": "High Fidelity",
      "description": "Music Top 5 with HIFI",
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
      "ownerAddress": "0x3f64c8bd049adeba075b4108c590294d186ecec6" // tuo minter
    }
  });
});

// =================================
// FRAME / MINI APP (overlay)
// =================================
app.get('/frame', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>High Fidelity</title>
  <script src="https://unpkg.com/@farcaster/miniapp-sdk@0.1.0/dist/miniapp-sdk.js"></script>
</head>
<body>
  <div id="app">
    <h1>High Fidelity</h1>
    <input type="text" id="category" placeholder="Categoria (es. songs)"><br><br>
    <input type="text" id="list" placeholder="Top 5 separati da virgola"><br><br>
    <button onclick="submitTop5()">Submit Top 5</button>
    <button onclick="dailyCheckIn()">Daily Check-in</button>
    <button onclick="viewTop5()">View Top 5</button>
    <button onclick="shareTop5()">Share Top 5</button>
    <div id="feedback"></div>
  </div>

  <script>
    // READY OBBLIGATORIO (fix splash screen)
    if (typeof MiniAppSDK !== 'undefined') {
      const { sdk } = MiniAppSDK;
      sdk.actions.ready();
      console.log("sdk.actions.ready() called");
    }

    async function submitTop5() {
      const category = document.getElementById('category').value || 'songs';
      const list = document.getElementById('list').value.split(',').map(i => i.trim()).filter(Boolean);
      const response = await fetch('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, list })
      });
      const data = await response.json();
      document.getElementById('feedback').innerText = data.message || 'Errore';
    }

    async function dailyCheckIn() {
      const response = await fetch('/checkin', { method: 'POST' });
      const data = await response.json();
      document.getElementById('feedback').innerText = data.message || 'Errore';
    }

    async function viewTop5() {
      const response = await fetch('/view', { method: 'POST' });
      const data = await response.json();
      document.getElementById('feedback').innerText = data.top5 ? data.top5.join(', ') : 'Nessuna classifica';
    }

    async function shareTop5() {
      const shareText = 'La mia Top 5 #HighFidelity';
      MiniAppSDK.sdk.actions.share(shareText);
    }
  </script>
</body>
</html>
  `.trim());
});

app.get('/', (req, res) => res.redirect('/frame'));

// =================================
// SUBMIT
// =================================
app.post('/submit', async (req, res) => {
  try {
    const { category, list } = req.body;
    const fid = req.headers['x-farcaster-fid'] || req.body.untrustedData?.fid;
    if (!fid) throw new Error("FID mancante");

    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { 'api-key': process.env.NEYNAR_API_KEY }
    });
    const address = userRes.data.users[0].custody_address;

    userData[fid] = userData[fid] || { lists: {}, address };
    userData[fid].lists[category] = list;

    aggregates[category] = aggregates[category] || {};
    list.forEach(item => aggregates[category][item] = (aggregates[category][item] || 0) + 1);

    if (contract) await contract.mint(address, ethers.parseUnits('10', 18));

    res.json({ success: true, message: 'Top 5 salvata! 10 HIFI mintati' });
  } catch (e) {
    console.error("Submit error:", e.message);
    res.json({ success: false, message: 'Errore submit' });
  }
});

// =================================
// CHECK-IN
// =================================
app.post('/checkin', async (req, res) => {
  try {
    const fid = req.headers['x-farcaster-fid'] || req.body.untrustedData?.fid;
    if (!fid) throw new Error("FID mancante");

    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { 'api-key': process.env.NEYNAR_API_KEY }
    });
    const address = userRes.data.users[0].custody_address;

    const now = Date.now();
    if (userData[fid]?.lastCheckin && now - userData[fid].lastCheckin < 86400000) {
      res.json({ success: false, message: 'Già fatto oggi' });
      return;
    }

    userData[fid] = userData[fid] || { address };
    userData[fid].lastCheckin = now;

    if (contract) await contract.mint(address, ethers.parseUnits('5', 18));

    res.json({ success: true, message: 'Check-in OK! 5 HIFI mintati' });
  } catch (e) {
    console.error("Check-in error:", e.message);
    res.json({ success: false, message: 'Errore check-in' });
  }
});

// =================================
// VIEW
// =================================
app.post('/view', async (req, res) => {
  try {
    const category = 'songs';
    const top5 = Object.entries(aggregates[category] || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([item]) => item);

    res.json({ success: true, top5 });
  } catch (e) {
    console.error("View error:", e.message);
    res.json({ success: false, message: 'Errore view' });
  }
});

// =================================
// SHARE
// =================================
app.post('/share', async (req, res) => {
  try {
    const fid = req.headers['x-farcaster-fid'] || req.body.untrustedData?.fid;
    if (!fid) throw new Error("FID mancante");

    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { 'api-key': process.env.NEYNAR_API_KEY }
    });
    const address = userRes.data.users[0].custody_address;

    const now = Date.now();
    if (userData[fid]?.lastShare && now - userData[fid].lastShare < 86400000) {
      res.json({ success: false, message: 'Già condiviso oggi' });
      return;
    }

    userData[fid] = userData[fid] || { address };
    userData[fid].lastShare = now;

    if (contract) await contract.mint(address, ethers.parseUnits('10', 18));

    const category = 'songs';
    const list = userData[fid].lists[category] || ['No list'];
    const shareText = \`La mia Top 5 \${category}: \${list.join(', ')} #HighFidelity\`;

    res.json({ success: true, message: 'Condiviso! 10 HIFI mintati', shareText });
  } catch (e) {
    console.error("Share error:", e.message);
    res.json({ success: false, message: 'Errore share' });
  }
});

// Cron reset aggregati
cron.schedule('0 0 * * 0', () => {
  aggregates = {};
  console.log('Aggregati resettati');
});

app.listen(port, () => console.log(\`Server live on port \${port}\`));
