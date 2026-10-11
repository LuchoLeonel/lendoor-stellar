import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { User } from 'src/domain/entities/user.entity';
import { FakeKycProvider } from './fake-kyc.provider';
import { assertKycGate, kycGateEnabled } from './kyc-gate';
import { KycService } from './kyc.service';

const WALLET = 'GDCZFUNJ7MXWBIQ6UUTJRGZIJF5EMRVJCSK73MA2U7K57GWMA4N3P6SL';

/** Repo fake minimo: findOne + update sobre un user en memoria. */
function makeRepo(user: Partial<User> | null) {
  const state = user ? ({ id: 1, walletAddress: WALLET, kycStatus: 'none', ...user } as User) : null;
  return {
    state,
    repo: {
      findOne: jest.fn(async () => state),
      update: jest.fn(async (_w: unknown, patch: Partial<User>) => {
        if (state) Object.assign(state, patch);
        return { affected: 1 };
      }),
    } as unknown as Repository<User>,
  };
}

afterEach(() => {
  delete process.env.KYC_GATE_ENABLED;
  delete process.env.KYC_FAKE_AUTO_APPROVE;
});

describe('kyc-gate — la regla del award, pura', () => {
  it('APAGADO por default: nadie se bloquea sin opt-in explicito', () => {
    expect(kycGateEnabled()).toBe(false);
    expect(() => assertKycGate({ kycStatus: 'none' })).not.toThrow();
    expect(() => assertKycGate({ kycStatus: undefined })).not.toThrow();
  });

  it('prendido: solo approved pasa; none/pending/rejected bloquean', () => {
    process.env.KYC_GATE_ENABLED = 'true';
    expect(() => assertKycGate({ kycStatus: 'approved' })).not.toThrow();
    for (const st of ['none', 'pending', 'rejected', null, undefined]) {
      expect(() => assertKycGate({ kycStatus: st as string })).toThrow(ForbiddenException);
    }
  });
});

describe('KycService — lifecycle contra el provider fake', () => {
  function make(user: Partial<User> | null = {}) {
    const { state, repo } = makeRepo(user);
    const provider = new FakeKycProvider();
    return { state, provider, service: new KycService(repo, provider) };
  }

  it('start: none → pending con sesion y URL; persiste provider y session', async () => {
    const { state, service } = make();
    const out = await service.start(WALLET);
    expect(out.status).toBe('pending');
    expect(out.sessionId).toMatch(/^fake-/);
    expect(out.verificationUrl).toContain(out.sessionId);
    expect(state!.kycStatus).toBe('pending');
    expect(state!.kycProvider).toBe('fake');
  });

  it('start es idempotente sobre pending (misma sesion, no multiplica)', async () => {
    const { service } = make();
    const first = await service.start(WALLET);
    const second = await service.start(WALLET);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it('start sobre approved no crea nada', async () => {
    const { service } = make({ kycStatus: 'approved' });
    expect(await service.start(WALLET)).toEqual({ status: 'approved' });
  });

  it('status refresca pending → approved (con timestamp) cuando el vendor aprueba', async () => {
    const { state, provider, service } = make();
    const { sessionId } = await service.start(WALLET);
    expect((await service.status(WALLET)).status).toBe('pending');
    provider.resolve(sessionId!, 'approved');
    expect((await service.status(WALLET)).status).toBe('approved');
    expect(state!.kycStatus).toBe('approved');
    expect(state!.kycApprovedAt).toBeInstanceOf(Date);
    // approved es pegajoso: una consulta mas no vuelve al vendor
    expect((await service.status(WALLET)).status).toBe('approved');
  });

  it('rejected limpia la sesion y start() permite reintentar', async () => {
    const { state, provider, service } = make();
    const { sessionId } = await service.start(WALLET);
    provider.resolve(sessionId!, 'rejected');
    expect((await service.status(WALLET)).status).toBe('rejected');
    expect(state!.kycSessionId).toBeNull();
    const retry = await service.start(WALLET);
    expect(retry.status).toBe('pending');
    expect(retry.sessionId).not.toBe(sessionId);
  });

  it('KYC_FAKE_AUTO_APPROVE=true aprueba sin resolve manual (e2e automatizados)', async () => {
    process.env.KYC_FAKE_AUTO_APPROVE = 'true';
    const { service } = make();
    await service.start(WALLET);
    expect((await service.status(WALLET)).status).toBe('approved');
  });

  it('wallet sin user: NotFound, nunca sesion huerfana en el vendor', async () => {
    const { service } = make(null);
    await expect(service.start(WALLET)).rejects.toThrow(NotFoundException);
    await expect(service.status(WALLET)).rejects.toThrow(NotFoundException);
  });
});

describe('el gate integra con el estado que KycService persiste', () => {
  it('flujo demo completo: bloqueado → aprueba → pasa', async () => {
    process.env.KYC_GATE_ENABLED = 'true';
    const { state, repo } = makeRepo({});
    const provider = new FakeKycProvider();
    const service = new KycService(repo as Repository<User>, provider);

    expect(() => assertKycGate(state!)).toThrow(ForbiddenException); // none
    const { sessionId } = await service.start(WALLET);
    expect(() => assertKycGate(state!)).toThrow(ForbiddenException); // pending
    provider.resolve(sessionId!, 'approved');
    await service.status(WALLET);
    expect(() => assertKycGate(state!)).not.toThrow(); // approved
  });
});
