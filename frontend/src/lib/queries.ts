// lib/queries.ts
export const LATEST_SNAPSHOT = `
query LatestSnapshot {
  vaultStatusSnapshots(
    first: 1
    orderBy: blockTimestamp
    orderDirection: desc
    where: { totalShares_gt: "0" }
  ) {
    blockTimestamp
    totalShares
    cash
    totalBorrows
  }
}
`

export const PAST_SNAPSHOT = (cutoff: string) => `
query PastSnapshot {
  vaultStatusSnapshots(
    first: 1
    orderBy: blockTimestamp
    orderDirection: desc
    where: {
      totalShares_gt: "0"
      blockTimestamp_lte: "${cutoff}"
    }
  ) {
    blockTimestamp
    totalShares
    cash
    totalBorrows
  }
}
`
// lib/queries.ts
export const VAULT_ACTIVITIES = (limit: number) => `
query VaultActivities {
  vaultActivities(
    first: ${limit}
    orderBy: blockTimestamp
    orderDirection: desc
    where: { type_in: ["DEPOSIT", "WITHDRAW"] }
  ) {
    id
    type
    account
    assets
    shares
    blockTimestamp
    txHash
  }
}
`
export const LATEST_UTIL_SNAPSHOT = `
query LatestUtilSnapshot {
  vaultStatusSnapshots(
    first: 1
    orderBy: blockTimestamp
    orderDirection: desc
    where: { totalShares_gt: "0" }
  ) {
    cash
    totalBorrows
    blockTimestamp
  }
}
`
export const PROTOCOL_STAT_QUERY = `
query ProtocolStat {
  protocolStat(id: "global") {
    loansOriginated
    uniqueBorrowers
    principalOriginated
    principalRepaid
    interestRepaid
    lastUpdated
  }
}
`

export const DAILY_PROTOCOL_STATS = `
query DailyProtocolStats {
  dailyProtocolStats(
    first: 1000
    orderBy: dayStart
    orderDirection: asc
  ) {
    id
    dayStart
    loansOriginated
    uniqueBorrowers
    principalOriginated
    principalRepaid
    interestRepaid
    lastUpdated
  }
}
`
export const LATEST_LOAN_ACTIVITIES = `
query LatestLoanActivities($first: Int!, $skip: Int!) {
  loanActivities(
    first: $first
    skip: $skip
    orderBy: blockTimestamp
    orderDirection: desc
    where: { type_in: ["OPEN", "CLOSE"] }
  ) {
    id
    type
    borrower
    principal
    amountDue
    paid
    blockTimestamp
    txHash
  }
}
`