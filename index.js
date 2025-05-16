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
