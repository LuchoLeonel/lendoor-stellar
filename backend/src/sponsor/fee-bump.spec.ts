import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  buildSponsoredFeeBump,
  sponsorBaseFee,
  SponsorPolicyViolation,
  validateInnerTx,
} from './fee-bump';

const PASSPHRASE = Networks.TESTNET;
// El par del award (B): los únicos contratos que el sponsor paga.
const VAULT_B = 'CDEJOQBQEZ7LUXSWXM4RF6EPBZLMJHMTGKC5GNWK5TNJR36TBHQLCULP';
const LM_B = 'CDIHUCP6DWKW7B6IUECP3SCK5WCI3W5ITNQDZEK2TNI55WLXDM6Y4WJJ';
// El par A, muerto: el ejemplo perfecto de contrato NO permitido.
const VAULT_A = 'CBENFIWPHQ4B4JVOBSSGVJ66BXANJZI4TVOLJE2D745YIRRH7IOVOJPV';

const policy = { allowedContracts: [VAULT_B, LM_B] } as const;

function invokeTx(opts: {
  source: Keypair;
  contract: string;
  fee?: string;
  sign?: boolean;
}): Transaction {
  const account = new Account(opts.source.publicKey(), '0');
  const tx = new TransactionBuilder(account, {
    fee: opts.fee ?? '100',
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: opts.contract,
        function: 'deposit',
        args: [],
      }),
    )
    .setTimeout(300)
    .build();
  if (opts.sign !== false) tx.sign(opts.source);
  return tx;
}

describe('sponsorBaseFee — el gotcha de Yield2Pay', () => {
  it('una tx clásica queda en el BASE_FEE de 100', () => {
    const kp = Keypair.random();
    expect(sponsorBaseFee(invokeTx({ source: kp, contract: VAULT_B }))).toBe('100');
  });

  it('con fee interno alto exige la inclusion fee por operación (la regla del SDK)', () => {
    const kp = Keypair.random();
    // 1 op clásica (sin sorobanData → resourceFee 0) con fee 1.000.001:
    // baseFee >= (1000001 − 0) / 1 = 1000001
    const tx = invokeTx({ source: kp, contract: VAULT_B, fee: '1000001' });
    expect(sponsorBaseFee(tx)).toBe('1000001');
  });
});

describe('validateInnerTx — la canilla de XLM cerrada', () => {
  const user = Keypair.random();

  it('acepta una invocación firmada a un contrato del award', () => {
    expect(() =>
      validateInnerTx(invokeTx({ source: user, contract: LM_B }), policy),
    ).not.toThrow();
  });

  it('rechaza una tx SIN firmar: el usuario firma primero, siempre', () => {
    expect(() =>
      validateInnerTx(invokeTx({ source: user, contract: VAULT_B, sign: false }), policy),
    ).toThrow(SponsorPolicyViolation);
  });

  it('rechaza la invocación a un contrato ajeno (el par A muerto, por ejemplo)', () => {
    expect(() =>
      validateInnerTx(invokeTx({ source: user, contract: VAULT_A }), policy),
    ).toThrow(/not an allowed contract/);
  });

  it('rechaza un source distinto del usuario autenticado', () => {
    const otro = Keypair.random();
    expect(() =>
      validateInnerTx(invokeTx({ source: user, contract: VAULT_B }), {
        ...policy,
        expectedSource: otro.publicKey(),
      }),
    ).toThrow(/not the authenticated user/);
  });

  it('rechaza un fee interno por encima del techo del sponsor', () => {
    expect(() =>
      validateInnerTx(invokeTx({ source: user, contract: VAULT_B, fee: '5000000' }), {
        ...policy,
        maxInnerFee: 1_000_000n,
      }),
    ).toThrow(/exceeds the sponsor cap/);
  });

  it('rechaza operaciones no patrocinables (un payment suelto, por ejemplo)', () => {
    const account = new Account(user.publicKey(), '0');
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: PASSPHRASE })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(300)
      .build();
    tx.sign(user);
    expect(() => validateInnerTx(tx, policy)).toThrow(/not sponsorable/);
  });

  it('acepta el changeTrust del primer uso (la trustline del USDC se patrocina)', () => {
    const usdc = new Asset('USDC', Keypair.random().publicKey());
    const account = new Account(user.publicKey(), '0');
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: PASSPHRASE })
      .addOperation(Operation.changeTrust({ asset: usdc }))
      .setTimeout(300)
      .build();
    tx.sign(user);
    expect(() => validateInnerTx(tx, policy)).not.toThrow();
  });
});

describe('buildSponsoredFeeBump — de punta a punta', () => {
  it('envuelve el sobre del usuario, lo firma el sponsor y el XDR redondea', () => {
    const user = Keypair.random();
    const sponsor = Keypair.random();
    const inner = invokeTx({ source: user, contract: VAULT_B, fee: '1000001' });

    const { feeBumpXdr, totalFee } = buildSponsoredFeeBump(
      inner.toXDR(),
      PASSPHRASE,
      sponsor,
      policy,
    );

    const bump = TransactionBuilder.fromXDR(feeBumpXdr, PASSPHRASE);
    expect('innerTransaction' in bump).toBe(true);
    const fb = bump as import('@stellar/stellar-sdk').FeeBumpTransaction;
    expect(fb.feeSource).toBe(sponsor.publicKey());
    // total = baseFee × (ops internas + 1) = 1000001 × 2
    expect(totalFee).toBe('2000002');
    // la firma interna del usuario viaja intacta
    expect(fb.innerTransaction.signatures).toHaveLength(1);
    expect(
      user.verify(
        fb.innerTransaction.hash(),
        fb.innerTransaction.signatures[0].signature() as Buffer,
      ),
    ).toBe(true);
    // y el bump viene firmado por el sponsor
    expect(fb.signatures).toHaveLength(1);
    expect(sponsor.verify(fb.hash(), fb.signatures[0].signature() as Buffer)).toBe(true);
  });

  it('se niega a envolver lo que la política rechaza', () => {
    const user = Keypair.random();
    const sponsor = Keypair.random();
    const inner = invokeTx({ source: user, contract: VAULT_A });
    expect(() =>
      buildSponsoredFeeBump(inner.toXDR(), PASSPHRASE, sponsor, policy),
    ).toThrow(SponsorPolicyViolation);
  });
});
