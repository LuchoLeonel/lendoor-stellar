import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { type ReactNode } from 'react'

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock useWallet
const mockWallet = {
  mode: 'webapp' as const,
  isMiniApp: false,
  primaryWallet: null as { address: string; chainId: number | null } | null,
}
vi.mock('@/providers/WalletProvider', () => ({
  useWallet: () => mockWallet,
}))

// Mock useTranslation
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock wagmi
vi.mock('wagmi', () => ({
  useWalletClient: () => ({ data: null }),
}))

// Mock Lemon SDK
vi.mock('@lemoncash/mini-app-sdk', () => ({
  authenticate: vi.fn(),
  deposit: vi.fn(),
  callSmartContract: vi.fn(),
  ChainId: { CELO: 42220 },
  TransactionResult: { SUCCESS: 'SUCCESS', PENDING: 'PENDING', CANCELLED: 'CANCELLED' },
}))

// Mock ethers — provide enough for the provider to initialize
const mockGetNetwork = vi.fn().mockResolvedValue({ chainId: 42220n })
const mockGetCode = vi.fn().mockResolvedValue('0x1234')
const mockContract = {
  decimals: vi.fn().mockResolvedValue(6),
  balanceOf: vi.fn().mockResolvedValue(0n),
  allowance: vi.fn().mockResolvedValue(0n),
}
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers')
  return {
    ...actual,
    JsonRpcProvider: vi.fn().mockImplementation(() => ({
      getNetwork: mockGetNetwork,
      getCode: mockGetCode,
      getSigner: vi.fn(),
    })),
    Contract: vi.fn().mockImplementation(() => mockContract),
    BrowserProvider: vi.fn().mockImplementation(() => ({
      getSigner: vi.fn().mockResolvedValue({
        getAddress: vi.fn().mockResolvedValue('0x1234567890abcdef1234567890abcdef12345678'),
      }),
    })),
  }
})

// Mock dedupeToast
vi.mock('@/lib/dedupeToast', () => ({
  dedupeToast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

// Mock viem
vi.mock('viem', () => ({
  encodeFunctionData: vi.fn().mockReturnValue('0x'),
}))

// Mock constants
vi.mock('@/lib/constants', () => ({
  USDC_ADDRESS: '0xusdc',
  EVAULT_ADDRESS: '0xevault',
  EVAULT_JUNIOR_ADDRESS: '0xjunior',
  EVAULT_CONTROLLER_ADDRESS: '0xcontroller',
  DEFAULT_CELO_RPCS: ['https://forno.celo.org'],
  EXPECTED_CHAIN_ID: 42220,
}))

// Mock contract ABIs
vi.mock('@/contracts/IEVault.json', () => ({ default: { abi: [] } }))
vi.mock('@/contracts/IEVC.json', () => ({ default: { abi: [] } }))

import { ContractsProvider, useContracts } from '../ContractsProvider'
import { callSmartContract as lemonCallSmartContract } from '@lemoncash/mini-app-sdk'

// ── Test helper to consume context ───────────────────────────────────────────

function ContextConsumer({ onContext }: { onContext: (ctx: ReturnType<typeof useContracts>) => void }) {
  const ctx = useContracts()
  onContext(ctx)
  return <div data-testid="consumer">ready={String(ctx.ready)}</div>
}

function renderWithProvider(ui: ReactNode) {
  return render(<ContractsProvider>{ui}</ContractsProvider>)
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ContractsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWallet.mode = 'webapp'
    mockWallet.isMiniApp = false
    mockWallet.primaryWallet = null
  })

  it('renders children', async () => {
    await act(async () => {
      renderWithProvider(<div data-testid="child">Hello</div>)
    })
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('provides context with correct shape', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    expect(captured).not.toBeNull()
    expect(captured).toHaveProperty('ready')
    expect(captured).toHaveProperty('mode')
    expect(captured).toHaveProperty('evault')
    expect(captured).toHaveProperty('usdc')
    expect(captured).toHaveProperty('signer')
    expect(captured).toHaveProperty('connectedAddress')
    expect(captured).toHaveProperty('sendContractTx')
    expect(captured).toHaveProperty('sendBatchContractTx')
    expect(captured).toHaveProperty('disconnect')
    expect(captured).toHaveProperty('refresh')
  })

  it('exposes the current wallet mode', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    mockWallet.mode = 'lemon'
    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    expect(captured?.mode).toBe('lemon')
  })

  it('exposes isWebView=true for mini-app mode', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    mockWallet.isMiniApp = true
    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    expect(captured?.isWebView).toBe(true)
  })

  it('exposes isWebView=false for webapp mode', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    mockWallet.isMiniApp = false
    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    expect(captured?.isWebView).toBe(false)
  })

  it('starts with null contracts when no wallet connected', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    mockWallet.primaryWallet = null
    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    expect(captured?.connectedAddress).toBeNull()
    expect(captured?.signer).toBeNull()
  })

  it('provides lemon helpers as null for webapp mode', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    mockWallet.mode = 'webapp'
    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    expect(captured?.lemon).toBeNull()
  })

  it('disconnect clears all contract state', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    await act(async () => {
      await captured?.disconnect()
    })

    expect(captured?.evault).toBeNull()
    expect(captured?.usdc).toBeNull()
    expect(captured?.signer).toBeNull()
    expect(captured?.connectedAddress).toBeNull()
  })

  it('useContracts throws when used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      render(<ContextConsumer onContext={() => {}} />)
    }).toThrow()

    spy.mockRestore()
  })

  it('sendContractTx is a function', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    expect(typeof captured?.sendContractTx).toBe('function')
  })

  it('sendBatchContractTx is a function', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    expect(typeof captured?.sendBatchContractTx).toBe('function')
  })

  it('treats Lemon single-call PENDING as success and returns txHash', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    mockWallet.mode = 'lemon'
    mockWallet.isMiniApp = true
    vi.mocked(lemonCallSmartContract).mockResolvedValue({
      result: 'PENDING',
      data: { txHash: '0xabc' },
    } as any)

    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    await expect(
      captured!.sendContractTx({
        contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
        functionName: 'borrowWithTerm',
        functionParams: ['1', '0x1234567890abcdef1234567890abcdef12345678', '7', '100'],
      }),
    ).resolves.toBe('0xabc')
  })

  it('treats Lemon batch PENDING as success and returns txHash', async () => {
    let captured: ReturnType<typeof useContracts> | null = null
    mockWallet.mode = 'lemon'
    mockWallet.isMiniApp = true
    vi.mocked(lemonCallSmartContract).mockResolvedValue({
      result: 'PENDING',
      data: { txHash: '0xdef' },
    } as any)

    await act(async () => {
      renderWithProvider(
        <ContextConsumer onContext={(ctx) => { captured = ctx }} />,
      )
    })

    await expect(
      captured!.sendBatchContractTx([
        {
          contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
          functionName: 'enableController',
          functionParams: [
            '0x1234567890abcdef1234567890abcdef12345678',
            '0xabcdef1234567890abcdef1234567890abcdef12',
          ],
        },
      ]),
    ).resolves.toEqual(['0xdef'])
  })
})
