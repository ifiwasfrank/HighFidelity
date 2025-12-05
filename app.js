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

// Contract setup
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

// Spotify (optional)
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

// Frame vNext (JSON embed)
app.get('/frame', (req, res) => {
  const embedJson = {
    version: "1",
    imageUrl: "https://placehold.co/600x400/png?text=Benvenuto+in+High+Fidelity",
    inputs: [
      { type: "text", placeholder: "Categoria (es. songs)" },
      { type: "text", placeholder: "Top 5 separati da virgola (es. song1,song2)" }
    ],
    buttons: [
      { title: "Submit Top 5", action: { type: "post", url: "https://highfidelity.onrender.com/submit" } },
      { title: "Daily Check-in", action: { type: "post", url: "https://highfidelity.onrender.com/checkin" } },
      { title: "View Top 5", action: { type: "post", url: "https://highfidelity.onrender.com/view" } },
      { title: "Share Top 5", action: { type: "post", url: "https://highfidelity.onrender.com/share" } }
    ]
  };
  const embedString = JSON.stringify(embedJson);
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="fc:miniapp" content="${embedString}" />
  <meta name="fc:frame" content="${embedString}" />
</head>
</html>
  `);
});

// Root
app.get('/', (req, res) => res.redirect('/frame'));

// Manifest
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

    const successEmbed = {
      version: "1",
      imageUrl: "https://placehold.co/600x400/png?text=Successo!+Top+5+Submitted",
      buttons: [{ title: "Back", action: { type: "post", url: "https://highfidelity.onrender.com/frame" } }]
    };
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="fc:miniapp" content="${JSON.stringify(successEmbed)}" />
  <meta name="fc:frame" content="${JSON.stringify(successEmbed)}" />
</head>
</html>
    `);
  } catch (e) {
    console.error('Submit error:', e.message);
    const errorEmbed = {
      version: "1",
      imageUrl: "https://placehold.co/600x400/png?text=Errore",
      buttons: [{ title: "Back", action: { type: "post", url: "https://highfidelity.onrender.com/frame" } }]
    };
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="fc:miniapp" content="${JSON.stringify(errorEmbed)}" />
  <meta name="fc:frame" content="${JSON.stringify(errorEmbed)}" />
</head>
</html>
    `);
  }
});

// Check-in
app.post('/checkin', async (req, res) => {
  try {
    const { untrustedData } = req.body;
    const fid = untrustedData.fid;
    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, { headers: { 'api-key': process.env.NEYNAR_API_KEY } });
    const address = userRes.data.users[0].custody_address;

    const now = Date.now();
    if (userData[fid]?.lastCheckin && now - userData[fid].lastCheckin < 86400000) {
      const errorEmbed = {
        version: "1",
        imageUrl: "https://placehold.co/600x400/png?text=Già+fatto+oggi",
        buttons: [{ title: "Back", action: { type: "post", url: "https://highfidelity.onrender.com/frame" } }]
      };
      res.send(`<!DOCTYPE html><html><head><meta name="fc:miniapp" content="${JSON.stringify(errorEmbed)}" /><meta name="fc:frame" content="${JSON.stringify(errorEmbed)}" /></head></html>`);
      return;
    }

    userData[fid] = userData[fid] || { address };
    userData[fid].lastCheckin = now;

    if (contract) await contract.mint(address, ethers.parseUnits('5', 18));

    const successEmbed = {
      version: "1",
      imageUrl: "https://placehold.co/600x400/png?text=Check-in+OK!+5+HIFI+mintati",
      buttons: [{ title: "Back", action: { type: "post", url: "https://highfidelity.onrender.com/frame" } }]
    };
    res.send(`<!DOCTYPE html><html><head><meta name="fc:miniapp" content="${JSON.stringify(successEmbed)}" /><meta name="fc:frame" content="${JSON.stringify(successEmbed)}" /></head></html>`);
  } catch (e) {
    console.error('Check-in error:', e.message);
    const errorEmbed = {
      version: "1",
      imageUrl: "https://placehold.co/600x400/png?text=Errore+Check-in",
      buttons: [{ title: "Back", action: { type: "post", url: "https://highfidelity.onrender.com/frame" } }]
    };
    res.send(`<!DOCTYPE html><html><head><meta name="fc:miniapp" content="${JSON.stringify(errorEmbed)}" /><meta name="fc:frame" content="${JSON.stringify(errorEmbed)}" /></head></html>`);
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

    const viewEmbed = {
      version: "1",
      imageUrl,
      buttons: [{ title: "Back", action: { type: "post", url: "https://highfidelity.onrender.com/frame" } }]
    };
    res.send(`<!DOCTYPE html><html><head><meta name="fc:miniapp" content="${JSON.stringify(viewEmbed)}" /><meta name="fc:frame" content="${JSON.stringify(viewEmbed)}" /></head></html>`);
  } catch (e) {
    console.error('View error:', e.message);
    const errorEmbed = {
      version: "1",
      imageUrl: "https://placehold.co/600x400/png?text=Errore+View",
      buttons: [{ title: "Back", action: { type: "post", url: "https://highfidelity.onrender.com/frame" } }]
    };
    res.send(`<!DOCTYPE html><html><head><meta name="fc:miniapp" content="${JSON.stringify(errorEmbed)}" /><meta name="fc:frame" content="${JSON.stringify(errorEmbed)}" /></head></html>`);
  }
});

// Share
app.post('/share', async (req, res) => {
  try {
    const { untrustedData } = req.body;
    const fid = untrustedData.fid;
    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, { headers: { 'api-key': process.env.NEYNAR_API_KEY } });
    const address = userRes.data.users[0].custody_address;

    const now = Date.now();
    if (userData[fid]?.lastShare && now - userData[fid].lastShare < 86400000) {
      const errorEmbed = {
        version: "1",
        imageUrl: "https://placehold.co/600x400/png?text=Già+condiviso+oggi",
        buttons: [{ title: "Back", action: { type: "post", url: "https://highfidelity.onrender.com/frame" } }]
      };
      res.send(`<!DOCTYPE html><html><head><meta name="fc:miniapp" content="${JSON.stringify(errorEmbed)}" /><meta name="fc:frame" content="${JSON.stringify(errorEmbed)}" /></head></html>`);
      return;
    }

    userData[fid] = userData[fid] || { address };
    userData[fid].lastShare = now;

    if (contract) await contract.mint(address, ethers.parseUnits('10', 18));

    const category = 'songs';
    const list = userData[fid].lists[category] || ['No list'];
    const shareText = `La mia Top 5 ${category}: ${list.join(', ')} #HighFidelity`;

    const shareEmbed = {
      version: "1",
      imageUrl: "https://placehold.co/600x400/png?text=Shared!+10+HIFI+mintati",
      buttons: [
        { title: "Post on Farcaster", action: { type: "post", url: `https://warpcast.com/~/compose?text=${encodeURIComponent(shareText)}` } },
        { title: "Share on X", action: { type: "link", url: `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}` } },
        { title: "Back", action: { type: "post", url: "https://highfidelity.onrender.com/frame" } }
      ]
    };
    res.send(`<!DOCTYPE html><html><head><meta name="fc:miniapp" content="${JSON.stringify(shareEmbed)}" /><meta name="fc:frame" content="${JSON.stringify(shareEmbed)}" /></head></html>`);
  } catch (e) {
    console.error('Share error:', e.message);
    const errorEmbed = {
      version: "1",
      imageUrl: "https://placehold.co/600x400/png?text=Errore+Share",
      buttons: [{ title: "Back", action: { type: "post", url: "https://highfidelity.onrender.com/frame" } }]
    };
    res.send(`<!DOCTYPE html><html><head><meta name="fc:miniapp" content="${JSON.stringify(errorEmbed)}" /><meta name="fc:frame" content="${JSON.stringify(errorEmbed)}" /></head></html>`);
  }
});

app.listen(port, () => console.log(`Server on port ${port}`));
