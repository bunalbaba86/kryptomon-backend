require('dotenv').config();
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const { ethers } = require("ethers");
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const tokenAddress = process.env.TOKEN_ADDRESS;

const tokenAbi = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];
const contract = new ethers.Contract(tokenAddress, tokenAbi, wallet);

// Bellekte kayıtlar
let playerRecords = {};   // /claim için: { wallet: { lastClaim, totalClaimed } }
let withdrawRecords = {}; // /withdraw için: { wallet: { lastWithdraw, totalWithdrawn } }
let ipRecords = {};       // IP spam için

const CLAIM_LIMIT = 0.1;
const WITHDRAW_LIMIT = 0.1;

const LOG_FILE = 'logs.json';
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, JSON.stringify([]));

// Her gece 00:00 resetle
cron.schedule('0 0 * * *', () => {
  playerRecords = {};
  withdrawRecords = {};
  ipRecords = {};
  console.log('🔁 Günlük limitler sıfırlandı.');
}, {
  timezone: 'Europe/Istanbul'
});

// ✅ Token bakiyesi (hazine)
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

// 🎮 Claim endpoint (score ile token kazancı)
app.post('/claim', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const { wallet, score } = req.body;

  if (!wallet || !score || isNaN(score)) {
    return res.status(400).json({ error: 'Missing wallet or score' });
  }

  const now = Date.now();

  // IP spam kontrolü
  if (ipRecords[ip] && now - ipRecords[ip] < 60 * 1000) {
    return res.status(429).json({ error: 'Too many requests from your IP. Please wait.' });
  }
  ipRecords[ip] = now;

  const record = playerRecords[wallet] || { lastClaim: 0, totalClaimed: 0 };

  if (now - record.lastClaim < 60 * 60 * 1000) {
    return res.status(429).json({ error: 'Please wait before claiming again (1 hour cooldown).' });
  }

  const tokensToSend = (score / 10000).toFixed(4);
  const total = parseFloat(record.totalClaimed) + parseFloat(tokensToSend);
  if (total > CLAIM_LIMIT) {
    return res.status(403).json({ error: 'Daily claim limit exceeded (max 0.1 Z1N3D/day).' });
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
      type: 'claim',
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

// 🎁 Token çekme (withdraw)
app.post('/withdraw', async (req, res) => {
  const { to, amount } = req.body;
  if (!to || !amount) {
    return res.status(400).json({ error: 'Missing "to" or "amount"' });
  }

  const now = Date.now();
  const record = withdrawRecords[to] || { lastWithdraw: 0, totalWithdrawn: 0 };

  if (now - record.lastWithdraw < 60 * 60 * 1000) {
    return res.status(429).json({ error: 'Please wait before withdrawing again (1 hour cooldown).' });
  }

  const total = parseFloat(record.totalWithdrawn) + parseFloat(amount);
  if (total > WITHDRAW_LIMIT) {
    return res.status(403).json({ error: 'Daily withdraw limit exceeded (max 0.1 Z1N3D/day).' });
  }

  try {
    const parsed = ethers.utils.parseUnits(amount.toString(), 18);
    const tx = await contract.transfer(to, parsed, {
      maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
      maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei')
    });
    await tx.wait();

    withdrawRecords[to] = {
      lastWithdraw: now,
      totalWithdrawn: total.toFixed(4)
    };

    const logs = JSON.parse(fs.readFileSync(LOG_FILE));
    logs.push({
      type: 'withdraw',
      wallet: to,
      tokens: amount,
      txHash: tx.hash,
      time: new Date().toISOString()
    });
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));

    res.json({ status: 'success', txHash: tx.hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Transfer failed', details: err.message });
  }
});

// 📄 Günlük claim geçmişi
app.get('/claim-log', (req, res) => {
  res.json(playerRecords);
});

// 🗂️ Admin logları
app.get('/admin', (req, res) => {
  try {
    const logs = JSON.parse(fs.readFileSync(LOG_FILE));
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// ✅ Sunucuyu başlat
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
