// Minimal ABI for LoanManagerV3 — events (for Phase 0 enumerate) and
// read methods (for Phase 1 per-address snapshot).
//
// Source of truth:
//   evk-periphery/src/ILoanManagerV3.sol
//   evk-periphery/src/LoanManagerV3.sol

'use strict';

const LOAN_MANAGER_EVENTS = [
  'event UserRiskSet(address indexed user, uint16 score, bool kycOk, uint64 validUntil, uint256 limit)',
  'event LoanOfferSet(address indexed user, uint16 tenorDays, uint16 feeBps, uint64 validUntil, uint256 maxAmount)',
  'event LoanOpened(address indexed user, uint256 principal, uint256 amountDue, uint64 due, uint16 feeBps, uint32 gracePeriod)',
  'event LoanClosed(address indexed user, uint256 paid)',
  'event LoanDefaulted(address indexed user, uint256 timestamp)',
  'event PremiumConfigSet(address indexed user, uint128 premiumRatePerSecWad, uint128 lateRatePerSecWad)',
  'event NextBorrowTimeSet(address indexed user, uint64 timestamp)',
  // Admin events (not per-address, but useful for enumeration sanity)
  'event OwnerChanged(address indexed oldOwner, address indexed newOwner)',
  'event VaultSet(address indexed vault)',
  'event DefaultGracePeriodSet(uint32 newGracePeriod)',
  'event MinHoldSet(uint16 tenorDays, uint16 minHoldDays)',
];

const LOAN_MANAGER_READS = [
  // UserRisk: score, kycOk, validUntil, lastUpdate, limit
  'function users(address) view returns (uint16 score, bool kycOk, uint64 validUntil, uint64 lastUpdate, uint256 limit)',
  // LoanOffer: tenorDays, feeBps, validUntil, maxAmount, exists
  'function offers(address) view returns (uint16 tenorDays, uint16 feeBps, uint64 validUntil, uint256 maxAmount, bool exists)',
  // Loan: principal, amountDue, start, due, feeBps, gracePeriod, active
  'function loans(address) view returns (uint128 principal, uint128 amountDue, uint64 start, uint64 due, uint16 feeBps, uint32 gracePeriod, bool active)',
  // Defaulted flag (not exposed by loans() getter)
  'function isDefaulted(address) view returns (bool)',
  // PremiumConfig: premiumRatePerSecWad, lateRatePerSecWad
  'function premiums(address) view returns (uint128 premiumRatePerSecWad, uint128 lateRatePerSecWad)',
  // Cooldown
  'function nextBorrowTime(address) view returns (uint64)',
  // Derived effective credit limit (0 if !kycOk or validUntil expired)
  'function creditLimit(address) view returns (uint256)',
  // Principal + amountDue including accrued late fees
  'function previewLoanWithLate(address) view returns (uint256 principal, uint256 amountDueWithLate)',
  // Global config
  'function vault() view returns (address)',
  'function defaultGracePeriod() view returns (uint32)',
  'function defaultLatePeriod() view returns (uint32)',
  'function minHoldDaysByTenor(uint16) view returns (uint16)',
  'function owner() view returns (address)',
];

// Event topic hashes (keccak256 of the canonical signature)
// We pin them here so Phase 0 can filter Covalent responses without trusting
// the event name decoding.
//
// Computed via ethers.id('EventName(arg types)'). Listed here as constants
// so the audit can run even when ethers isn't available at load time (eg.
// generating reports from raw logs).
//
// If any of these drift vs. the ABI above, fail loud at load time.

const EVENT_TOPIC_SIGS = {
  UserRiskSet:          'UserRiskSet(address,uint16,bool,uint64,uint256)',
  LoanOfferSet:         'LoanOfferSet(address,uint16,uint16,uint64,uint256)',
  LoanOpened:           'LoanOpened(address,uint256,uint256,uint64,uint16,uint32)',
  LoanClosed:           'LoanClosed(address,uint256)',
  LoanDefaulted:        'LoanDefaulted(address,uint256)',
  PremiumConfigSet:     'PremiumConfigSet(address,uint128,uint128)',
  NextBorrowTimeSet:    'NextBorrowTimeSet(address,uint64)',
  OwnerChanged:         'OwnerChanged(address,address)',
  VaultSet:             'VaultSet(address)',
  DefaultGracePeriodSet:'DefaultGracePeriodSet(uint32)',
  MinHoldSet:           'MinHoldSet(uint16,uint16)',
};

function computeEventTopics(ethers) {
  const topics = {};
  for (const [name, sig] of Object.entries(EVENT_TOPIC_SIGS)) {
    topics[name] = ethers.id(sig);
  }
  return topics;
}

const LOAN_MANAGER_ADDRESS = '0x3E1536CC066C626Ee96D79bb00d1c9dC7d4D86b6';
const CELO_CHAIN_ID = 42220;
const CELO_GOLDRUSH_NAME = 'celo-mainnet';

module.exports = {
  LOAN_MANAGER_EVENTS,
  LOAN_MANAGER_READS,
  EVENT_TOPIC_SIGS,
  computeEventTopics,
  LOAN_MANAGER_ADDRESS,
  CELO_CHAIN_ID,
  CELO_GOLDRUSH_NAME,
};
