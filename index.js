require('dotenv').config();
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const { ethers } = require("ethers");
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

// 📌 Blockchain bağlantısı
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const tokenAddress = process.env.TOKEN_ADDRESS;

const tokenAbi = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];
const contract = new ethers.Contract(tokenAddress, tokenAbi, wallet);

// 📌 Kayıtlar bellekte tutulur
let playerRecords = {}; // { wallet: { lastClaim, totalClaimed } }
let ipRecords = {};     // { ip: timestamp }
const DAILY_LIMIT = 0.1;
const LOG_FILE = 'logs.json';

// İlk çalışmada log dosyası oluştur
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, JSON.stringify([]));

// 🕐 Her gece 00:00'da günlük limitleri sıfırla
cron.schedule('0 0 * * *', () => {
  playerRecords = {};
  ipRecords = {};
  console.log('🔁 Daily limits reset.');
}, {
  timezone: 'Europe/Istanbul'
});

// 🎯 Token bakiyesi
app.get('/balance', async (req, res) => {
  try {
    const balance = await contract.balanceOf(wallet.address);
    const decimals = await contract.decimals();
    const formatted = ethers.utils.formatUnits(balance, decimals);
    res.json({ balance: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch token balance' });
  }
});

// 🎁 Token çekme (withdraw)
app.post('/withdraw', async (req, res) => {
  const { to, amount } = req.body;
  if (!to || !amount) {
    return res.status(400).json({ error: 'Missing "to" or "amount"' });
  }

  try {
    const parsed = ethers.utils.parseUnits(amount.toString(), 18);
    const tx = await contract.transfer(to, parsed, {
      maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
      maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei')
    });
    await tx.wait();
    res.json({ status: 'success', txHash: tx.hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Transfer failed', details: err.message });
  }
});

// 🎮 Puanla claim etme (maks. 0.1 Z1N3D/gün)
app.post('/claim', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const { wallet, score } = req.body;

  if (!wallet || !score || isNaN(score)) {
    return res.status(400).json({ error: 'Missing wallet or score' });
  }

  const now = Date.now();

  // IP koruması: 1 dakikada bir
  if (ipRecords[ip] && now - ipRecords[ip] < 60 * 1000) {
    return res.status(429).json({ error: 'Too many requests from your IP. Please wait.' });
  }
  ipRecords[ip] = now;

  // Günlük geçmiş kontrolü
  const record = playerRecords[wallet] || { lastClaim: 0, totalClaimed: 0 };
  if (now - record.lastClaim < 60 * 60 * 1000) {
    return res.status(429).json({ error: 'Please wait before claiming again (1 hour cooldown).' });
  }

  const tokensToSend = (score / 10000).toFixed(4);
  const total = parseFloat(record.totalClaimed) + parseFloat(tokensToSend);
  if (total > DAILY_LIMIT) {
    return res.status(403).json({ error: 'Daily limit exceeded (max 0.1 Z1N3D/day).' });
  }

  const parsedAmount = ethers.utils.parseUnits(tokensToSend, 18);

  try {
    const tx = await contract.transfer(wallet, parsedAmount, {
      maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
      maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei'),
    });

    await tx.wait();

    playerRecords[wallet] = {
      lastClaim: now,
      totalClaimed: total.toFixed(4)
    };

    const logs = JSON.parse(fs.readFileSync(LOG_FILE));
    logs.push({
      wallet,
      ip,
      tokens: tokensToSend,
      score,
      txHash: tx.hash,
      time: new Date().toISOString()
    });
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));

    res.json({ status: 'success', txHash: tx.hash, amount: tokensToSend });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Token transfer failed', details: err.message });
  }
});

// 🧾 Sadece günlük claim geçmişi
app.get('/claim-log', (req, res) => {
  res.json(playerRecords);
});

// 🗂️ Tüm işlemlerin logları
app.get('/admin', (req, res) => {
  try {
    const logs = JSON.parse(fs.readFileSync(LOG_FILE));
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// ✅ Sunucu başlat
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
