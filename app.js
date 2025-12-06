require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const axios = require('axios');
const cron = require('node-cron');
const { useMiniKit } = require('@farcaster/miniapp-sdk');
const { useOnchainKit } = require('@coinbase/onchainkit');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Contract
let contract = null;
try {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const abi = ["function mint(address to, uint256 amount) public"];
  contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);
  console.log("Contract OK");
} catch (err) {
  console.error("Contract error:", err.message);
}

// DB
let userData = {};
let aggregates = {};

// Serve manifest
app.get('/.well-known/farcaster.json', (req, res) => {
  res.json({
    "isValid": true,
    "messages": []
  });
});

// Frame embed (mini app entry)
app.get('/frame', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>High Fidelity</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:title" content="High Fidelity">
  <meta property="og:description" content="Top 5 musicali con $HIFI">
  <meta property="og:image" content="https://placehold.co/1200x630/png?text=High+Fidelity">
  <meta property="fc:frame" content="vNext">
  <meta property="fc:frame:validate" content="true">
  <meta property="fc:frame:interaction" content="true">
  <meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Benvenuto+in+High+Fidelity">
  <script src="https://unpkg.com/@farcaster/miniapp-sdk@0.1.0/dist/miniapp-sdk.js"></script>
  <script src="https://unpkg.com/@coinbase/onchainkit@0.1.0/dist/onchainkit.js"></script>
</head>
<body>
  <div id="app"></div>
  <script>
    const { sdk } = MiniAppSDK;
    sdk.actions.ready();
    const { useOnchainKit } = OnchainKit;
    // App UI (bottoni, input)
    document.getElementById('app').innerHTML = `
      <h1>High Fidelity</h1>
      <input type="text" id="category" placeholder="Categoria (es. songs)">
      <input type="text" id="list" placeholder="Top 5 separati da virgola">
      <button onclick="submitTop5()">Submit Top 5</button>
      <button onclick="dailyCheckIn()">Daily Check-in</button>
      <button onclick="viewTop5()">View Top 5</button>
      <button onclick="shareTop5()">Share Top 5</button>
    `;
    async function submitTop5() {
      const category = document.getElementById('category').value;
      const list = document.getElementById('list').value.split(',');
      await fetch('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ untrustedData: { fid: sdk.context.fid, inputText: category + '\\n' + list.join(',') } })
      });
      sdk.actions.update({ image: 'https://placehold.co/600x400/png?text=Successo!' });
    }
    async function dailyCheckIn() {
      await fetch('/checkin', { method: 'POST' });
      sdk.actions.update({ image: 'https://placehold.co/600x400/png?text=Check-in+OK!' });
    }
    async function viewTop5() {
      await fetch('/view', { method: 'POST' });
      sdk.actions.update({ image: 'https://placehold.co/600x400/png?text=Top+5!' });
    }
    async function shareTop5() {
      const shareText = 'La mia Top 5 #HighFidelity';
      sdk.actions.share(shareText);
    }
  </script>
</body>
</html>
  `.trim());
});

// Submit (backend)
app.post('/submit', async (req, res) => {
  try {
    const { untrustedData } = req.body;
    const fid = untrustedData.fid;
    const inputTexts = untrustedData.inputText.split('\\n');
    const category = inputTexts[0].trim() || 'songs';
    const list = inputTexts[1].trim().split(',').map(i => i.trim());

    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { 'api-key': process.env.NEYNAR_API_KEY }
    });
    const address = userRes.data.users[0].custody_address;

    userData[fid] = userData[fid] || { lists: {}, address };
    userData[fid].lists[category] = list;

    aggregates[category] = aggregates[category] || {};
    list.forEach(item => aggregates[category][item] = (aggregates[category][item] || 0) + 1);

    if (contract) await contract.mint(address, ethers.parseUnits('10', 18));

    res.json({ success: true, image: 'https://placehold.co/600x400/png?text=Top+5+salvata!' });
  } catch (e) {
    console.error(e);
    res.json({ success: false, image: 'https://placehold.co/600x400/png?text=Errore' });
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
      res.json({ success: false, image: 'https://placehold.co/600x400/png?text=Già+fatto+oggi' });
      return;
    }

    userData[fid] = userData[fid] || { address };
    userData[fid].lastCheckin = now;

    if (contract) await contract.mint(address, ethers.parseUnits('5', 18));

    res.json({ success: true, image: 'https://placehold.co/600x400/png?text=Check-in+OK!' });
  } catch (e) {
    console.error(e);
    res.json({ success: false, image: 'https://placehold.co/600x400/png?text=Errore' });
  }
});

// View
app.post('/view', async (req, res) => {
  try {
    const category = 'songs';
    const top5 = Object.entries(aggregates[category] || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([item]) => item);

    const links = await Promise.all(top5.map(getSpotifyLink));
    const topWithLinks = top5.map((item, i) => `${item} - ${links[i] || 'No link'}`).join('\n');

    const imageUrl = `https://placehold.co/600x400/png?text=Top+5+${topWithLinks.substring(0, 50)}...`;

    res.json({ success: true, image: imageUrl });
  } catch (e) {
    console.error(e);
    res.json({ success: false, image: 'https://placehold.co/600x400/png?text=Errore' });
  }
});

// Share
app.post('/share', async (req, res) => {
  try {
    const { untrustedData } = req.body;
    const fid = untrustedData.fid;
    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { 'api-key': process.env.NEYNAR_API_KEY }
    });
    const address = userRes.data.users[0].custody_address;

    const now = Date.now();
    if (userData[fid]?.lastShare && now - userData[fid].lastShare < 86400000) {
      res.json({ success: false, image: 'https://placehold.co/600x400/png?text=Già+condiviso+oggi' });
      return;
    }

    userData[fid] = userData[fid] || { address };
    userData[fid].lastShare = now;

    if (contract) await contract.mint(address, ethers.parseUnits('10', 18));

    const category = 'songs';
    const list = userData[fid].lists[category] || ['No list'];
    const shareText = `La mia Top 5 ${category}: ${list.join(', ')} #HighFidelity`;

    res.json({ success: true, image: 'https://placehold.co/600x400/png?text=Shared!+10+HIFI+mintati', shareUrl: `https://warpcast.com/~/compose?text=${encodeURIComponent(shareText)}` });
  } catch (e) {
    console.error(e);
    res.json({ success: false, image: 'https://placehold.co/600x400/png?text=Errore' });
  }
});

// Cron reset
cron.schedule('0 0 * * 0', () => {
  aggregates = {};
  console.log('Aggregati resettati');
});

app.listen(port, () => console.log(`Server live on port ${port}`));
