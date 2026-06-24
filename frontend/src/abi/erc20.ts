import { parseAbi } from 'viem'

// Versión "human readable" (estilo ethers)
export const ERC20_ABI_HUMAN = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
] as const

// ✅ ABI parseado compatible con viem.encodeFunctionData
// También sirve como ABI JSON para ethers.Contract
export const ERC20_ABI = parseAbi(ERC20_ABI_HUMAN)
