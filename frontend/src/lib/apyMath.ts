// lib/apyMath.ts
function toNum(x: string) {
    return Number(x)
  }
  
  export function calcTotalAssets(s: { cash: string; totalBorrows: string }) {
    return toNum(s.cash) + toNum(s.totalBorrows)
  }
  
  export function calcSharePrice(s: {
    totalShares: string
    cash: string
    totalBorrows: string
  }) {
    const assets = calcTotalAssets(s)
    const shares = toNum(s.totalShares)
    if (shares === 0) return 0
    return assets / shares
  }
  
  export function calcApyFromPrices(priceNow: number, pricePast: number, days: number) {
    if (!pricePast || !priceNow) return 0
    const ratio = priceNow / pricePast
    if (ratio <= 0) return 0
  
    // compuesto
    const apy = Math.pow(ratio, 365 / days) - 1
    return apy
  }
  
  export function project30dFromApy(apy: number) {
    return Math.pow(1 + apy, 30 / 365) - 1
  }