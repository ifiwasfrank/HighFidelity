console.log("Starting app.js...");
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const axios = require('axios');
const cron = require('node-cron');
const app = express();
const port = process.env.PORT || 10000;  // Render usa 10000

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

// Frame vNext (JSON embed for miniapp)
app.get('/frame', (req, res) => {
  console.log('Frame requested');
  const embed = {
    version: "vNext",
    image: "https://placehold.co/600x400/png?text=Benvenuto+in+High+Fidelity",
    inputs: [
      { type: "text", placeholder: "Categoria (es. songs)" },
      { type: "text", placeholder: "Top 5 separati da virgola" }
    ],
    buttons: [
      { label: "Submit Top 5", action: { type: "post", target: "https://highfidelity.onrender.com/submit" } },
      { label: "Daily Check-in", action: { type: "post", target: "https://highfidelity.onrender.com/checkin" } },
      { label: "View Top 5", action: { type: "post", target: "https://highfidelity.onrender.com/view" } },
      { label: "Share Top 5", action: { type: "post", target: "https://highfidelity.onrender.com/share" } }
    ]
  };
  res.json(embed);
});

// Root redirect
app.get('/', (req, res) => res.redirect('/frame'));

// Manifest
app.get('/.well-known/farcaster.json', (req, res) => res.json({ isValid: true, messages: [] }));

// Submit
app.post('/submit', async (req, res) => {
  try {
    console.log('Submit requested');
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
      version: "vNext",
      image: "https://placehold.co/600x400/png?text=Successo!+10+HIFI+mintati",
      buttons: [{ label: "Back", action: { type: "post", target: "https://highfidelity.onrender.com/frame" } }]
    };
    res.json(successEmbed);
  } catch (e) {
    console.error('Submit error:', e.message);
    const errorEmbed = {
      version: "vNext",
      image: "https://placehold.co/600x400/png?text=Errore+Submit",
      buttons: [{ label: "Back", action: { type: "post", target: "https://highfidelity.onrender.com/frame" } }]
    };
    res.json(errorEmbed);
  }
});

// Check-in
app.post('/checkin', async (req, res) => {
  try {
    console.log('Check-in requested');
    const { untrustedData } = req.body;
    const fid = untrustedData.fid;
    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, { headers: { 'api-key': process.env.NEYNAR_API_KEY } });
    const address = userRes.data.users[0].custody_address;

    const now = Date.now();
    if (userData[fid]?.lastCheckin && now - userData[fid].lastCheckin < 86400000) {
      const errorEmbed = {
        version: "vNext",
        image: "https://placehold.co/600x400/png?text=Già+fatto+oggi",
        buttons: [{ label: "Back", action: { type: "post", target: "https://highfidelity.onrender.com/frame" } }]
      };
      res.json(errorEmbed);
      return;
    }

    userData[fid] = userData[fid] || { address };
    userData[fid].lastCheckin = now;

    if (contract) await contract.mint(address, ethers.parseUnits('5', 18));

    const successEmbed = {
      version: "vNext",
      image: "https://placehold.co/600x400/png?text=Check-in+OK!+5+HIFI+mintati",
      buttons: [{ label: "Back", action: { type: "post", target: "https://highfidelity.onrender.com/frame" } }]
    };
    res.json(successEmbed);
  } catch (e) {
    console.error('Check-in error:', e.message);
    const errorEmbed = {
      version: "vNext",
      image: "https://placehold.co/600x400/png?text=Errore+Check-in",
      buttons: [{ label: "Back", action: { type: "post", target: "https://highfidelity.onrender.com/frame" } }]
    };
    res.json(errorEmbed);
  }
});

// View
app.post('/view', async (req, res) => {
  try {
    console.log('View requested');
    const category = 'songs';
    const top5 = Object.entries(aggregates[category] || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([item]) => item);

    const links = await Promise.all(top5.map(getSpotifyLink));
    const topWithLinks = top5.map((item, i) => `${item} - ${links[i] || 'No link'}`).join('\n');

    const imageUrl = `https://placehold.co/600x400/png?text=Top+5+${topWithLinks.substring(0, 50)}...`;

    const viewEmbed = {
      version: "vNext",
      image: imageUrl,
      buttons: [{ label: "Back", action: { type: "post", target: "https://highfidelity.onrender.com/frame" } }]
    };
    res.json(viewEmbed);
  } catch (e) {
    console.error('View error:', e.message);
    const errorEmbed = {
      version: "vNext",
      image: "https://placehold.co/600x400/png?text=Errore+View",
      buttons: [{ label: "Back", action: { type: "post", target: "https://highfidelity.onrender.com/frame" } }]
    };
    res.json(errorEmbed);
  }
});

// Share
app.post('/share', async (req, res) => {
  try {
    console.log('Share requested');
    const { untrustedData } = req.body;
    const fid = untrustedData.fid;
    const userRes = await axios.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, { headers: { 'api-key': process.env.NEYNAR_API_KEY } });
    const address = userRes.data.users[0].custody_address;

    const now = Date.now();
    if (userData[fid]?.lastShare && now - userData[fid].lastShare < 86400000) {
      const errorEmbed = {
        version: "vNext",
        image: "https://placehold.co/600x400/png?text=Già+condiviso+oggi",
        buttons: [{ label: "Back", action: { type: "post", target: "https://highfidelity.onrender.com/frame" } }]
      };
      res.json(errorEmbed);
      return;
    }

    userData[fid] = userData[fid] || { address };
    userData[fid].lastShare = now;

    if (contract) await contract.mint(address, ethers.parseUnits('10', 18));

    const category = 'songs';
    const list = userData[fid].lists[category] || ['No list'];
    const shareText = `La mia Top 5 ${category}: ${list.join(', ')} #HighFidelity`;

    const shareEmbed = {
      version: "vNext",
      image: "https://placehold.co/600x400/png?text=Shared!+10+HIFI+mintati",
      buttons: [
        { label: "Post on Farcaster", action: { type: "post", target: `https://warpcast.com/~/compose?text=${encodeURIComponent(shareText)}` } },
        { label: "Share on X", action: { type: "link", target: `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}` } },
        { label: "Back", action: { type: "post", target: "https://highfidelity.onrender.com/frame" } }
      ]
    };
    res.json(shareEmbed);
  } catch (e) {
    console.error('Share error:', e.message);
    const errorEmbed = {
      version: "vNext",
      image: "https://placehold.co/600x400/png?text=Errore+Share",
      buttons: [{ label: "Back", action: { type: "post", target: "https://highfidelity.onrender.com/frame" } }]
    };
    res.json(errorEmbed);
  }
});

app.listen(port, () => console.log(`Server on port ${port} - Ready`));
