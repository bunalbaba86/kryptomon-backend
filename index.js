require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require("ethers");

const app = express();
app.use(cors());
app.use(express.json());

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const tokenAddress = process.env.TOKEN_ADDRESS;
const tokenAbi = [
  "function transfer(address to, uint256 amount) public returns (bool)"
];
const contract = new ethers.Contract(tokenAddress, tokenAbi, wallet);

app.post('/withdraw', async (req, res) => {
  const { to, amount } = req.body;

  if (!to || !amount) {
    return res.status(400).json({ error: 'Missing to or amount' });
  }

  try {
    const amountParsed = ethers.utils.parseUnits(amount.toString(), 18);
    const tx = await contract.transfer(to, amountParsed, {
  maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
  maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei')
});
    await tx.wait();
    res.json({ status: 'success', txHash: tx.hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Transfer failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
app.get('/balance', async (req, res) => {
  try {
    const tokenAbi = [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)"
    ];
    const contract = new ethers.Contract(tokenAddress, tokenAbi, provider);
    const balance = await contract.balanceOf(wallet.address);
    const decimals = await contract.decimals();
    const formatted = ethers.utils.formatUnits(balance, decimals);
    res.json({ balance: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch token balance' });
  }
});
const DAILY_LIMIT = 1; // max 1 token çekebilir
const playerRecords = {}; // { walletAddress: { lastClaim, totalClaimed } }

app.post('/claim', async (req, res) => {
  const { wallet, score } = req.body;

  if (!wallet || !score || isNaN(score)) {
    return res.status(400).json({ error: 'Missing wallet or score' });
  }

  // Token hesabı (örnek: 100 puan = 0.01 Z1N3D)
  const tokensToSend = (score / 10000).toFixed(4); // yani 0.0001 * score
  const amountParsed = ethers.utils.parseUnits(tokensToSend, 18);

  const now = Date.now();
  const record = playerRecords[wallet] || { lastClaim: 0, totalClaimed: 0 };

  // Cooldown kontrolü: 1 saat
  if (now - record.lastClaim < 60 * 60 * 1000) {
    return res.status(429).json({ error: 'Please wait before claiming again.' });
  }

  // Günlük limit kontrolü
  const total = parseFloat(record.totalClaimed) + parseFloat(tokensToSend);
  if (total > DAILY_LIMIT) {
    return res.status(403).json({ error: 'Daily limit exceeded.' });
  }

  try {
    const tx = await contract.transfer(wallet, amountParsed, {
      maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
      maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei'),
    });

    await tx.wait();

    playerRecords[wallet] = {
      lastClaim: now,
      totalClaimed: total.toFixed(4),
    };

    res.json({ status: 'success', txHash: tx.hash, amount: tokensToSend });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Token transfer failed' });
  }
});

