console.log("Starting app.js...");
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const axios = require('axios');
const cron = require('node-cron');
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Contract
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

// DB
let userData = {};
let aggregates = {};

// Frame principale
app.get('/frame', (req, res) => {
  res.set('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="https://placehold.co/1200x630?text=High+Fidelity+Top+5&font_size=60" />
  <meta property="fc:frame:image:aspect_ratio" content="1.91:1" />
  <meta property="fc:frame:input:text" content="Categoria (ex: songs)" />
  <meta property="fc:frame:input:text" content="Top 5 separati da virgola" />
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
<body></body>
</html>
  `.trim());
});

// Root
app.get('/', (req, res) => res.redirect('/frame'));

// Manifest (opzionale)
app.get('/.well-known/farcaster.json', (req, res) => res.json({ isValid: true, messages: [] }));

// Submit
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
<html>
<head>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:validate" content="true" />
  <meta property="fc:frame:image" content="https://placehold.co/600x400/png?text=Top+5+salvata!+10+HIFI+mintati" />
  <meta property="fc:frame:button:1" content="Torna al menu" />
  <meta property="fc:frame:button:1:action" content="post" />
  <meta property="fc:frame:button:1:target" content="https://highfidelity.onrender.com/frame" />
</head>
</html>
    `.trim());
  } catch (e) {
    console.error("Submit error:", e.message);
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:validate" content="true" />
  <meta property="fc:frame:image" content="https://placehold.co/600x400/red/white?text=Errore" />
  <meta property="fc:frame:button:1" content="Riprova" />
  <meta property="fc:frame:button:1:action" content="post" />
  <meta property="fc:frame:button:1:target" content="https://highfidelity.onrender.com/frame" />
</head>
</html>
    `.trim());
  }
});

// Check-in (stessa struttura, aggiungi le altre route se vuoi)
app.post('/checkin', async (req, res) => {
  // ... (stesso codice di prima con try/catch e validate tag)
});

// View, Share → aggiungi con lo stesso formato

app.listen(port, () => console.log(`Server running on port ${port}`));

