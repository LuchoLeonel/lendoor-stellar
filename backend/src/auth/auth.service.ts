// src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, randomBytes } from 'crypto';
import { createPublicClient, http, recoverMessageAddress } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';

import { SiweNonce } from 'src/domain/entities/siwe-nonce.entity';
import { AccessToken } from 'src/domain/entities/access-token.entity';
import { normalizeWallet } from 'src/common/normalize-wallet';
import { decodeStellarPublicKey } from 'src/common/stellar-strkey';

interface TokenCacheEntry {
  walletAddress: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(SiweNonce)
    private readonly nonceRepo: Repository<SiweNonce>,
    @InjectRepository(AccessToken)
    private readonly tokenRepo: Repository<AccessToken>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  // =============== helpers de chain para SIWE =================

  /** Devuelve un objeto "chain" para viem según el chainId del mensaje SIWE. */
  private getChainConfig(chainId: number): {
    id: number;
    name: string;
    network: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: {
      default: { http: string[] };
      public: { http: string[] };
    };
  } {
    // Base mainnet (8453)
    if (chainId === 8453) {
      return {
        id: 8453,
        name: 'Base',
        network: 'base',
        nativeCurrency: {
          name: 'Ether',
          symbol: 'ETH',
          decimals: 18,
        },
        rpcUrls: {
          default: {
            http: ['https://mainnet.base.org'],
          },
          public: {
            http: ['https://mainnet.base.org'],
          },
        },
      };
    }

    // Celo (42220)
    if (chainId === 42220) {
      return {
        id: 42220,
        name: 'Celo',
        network: 'celo',
        nativeCurrency: {
          name: 'CELO',
          symbol: 'CELO',
          decimals: 18,
        },
        rpcUrls: {
          default: {
            http: ['https://forno.celo.org'],
          },
          public: {
            http: ['https://forno.celo.org'],
          },
        },
      };
    }

    // Fallback genérico (Base)
    this.logger.warn(
      `SIWE: chainId desconocido (${chainId}), usando Base como fallback`,
    );

    return {
      id: 8453,
      name: 'Base',
      network: 'base',
      nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
      rpcUrls: {
        default: {
          http: ['https://mainnet.base.org'],
        },
        public: {
          http: ['https://mainnet.base.org'],
        },
      },
    };
  }

  /** Detecta si el dominio del mensaje SIWE corresponde a Lemon miniapps. */
  private isLemonDomain(domain: string): boolean {
    const d = domain.toLowerCase();
    return (
      d.endsWith('.lemoncash.com.ar') ||
      d === 'lemoncash.com.ar' ||
      d.endsWith('.lemon.me') ||
      d === 'lemon.me'
    );
  }

  // ===================== NONCE =====================

  async createNonce(): Promise<string> {
    const nonce = randomBytes(16).toString('hex'); // 32 chars >= 8
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    const entity = this.nonceRepo.create({
      nonce,
      used: false,
      expiresAt,
    });

    await this.nonceRepo.save(entity);

    this.logger.log(
      `Created nonce=${nonce} expiresAt=${expiresAt.toISOString()}`,
    );

    return nonce;
  }

  // =========== SIWE VERIFY + ISSUE ACCESS TOKEN ===========

  async verifySiweAndIssueToken(input: {
    wallet: string; // sólo para logs; la verdad viene del mensaje
    signature: string;
    message: string;
    nonce: string; // sólo para logging (en Lemon no se usa DB para validar)
  }): Promise<{ wallet: string; accessToken: string }> {
    const { wallet, signature, message, nonce } = input;
    const now = new Date();

    this.logger.log(
      `verifySiweAndIssueToken IN body.wallet=${wallet} body.nonce=${nonce} at=${now.toISOString()}`,
    );
    this.logger.debug(`SIWE raw message:\n${message}`);

    // 1) Parsear mensaje SIWE primero
    let parsed: ReturnType<typeof parseSiweMessage>;
    try {
      parsed = parseSiweMessage(message);
      this.logger.log(
        `Parsed SIWE message address=${parsed.address} nonce=${parsed.nonce} chainId=${parsed.chainId} domain=${parsed.domain}`,
      );
    } catch (err: unknown) {
      const message_err = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error parseando SIWE message: ${message_err}`);
      throw new UnauthorizedException('Invalid SIWE message');
    }

    this.logger.debug(parsed);
    const addressFromMessage = (parsed.address as string)?.toLowerCase();
    const nonceFromMessage = parsed.nonce;
    const chainIdFromMessage = Number(parsed.chainId ?? 0);
    const domainFromMessage = String(parsed.domain || '');
    const isLemon = this.isLemonDomain(domainFromMessage);

    if (!nonceFromMessage) {
      this.logger.warn(
        `SIWE message sin nonce. body.nonce=${nonce} domain=${domainFromMessage}`,
      );
      throw new UnauthorizedException('Missing nonce in SIWE message');
    }

    // 2) Chequear nonce en DB SOLO si NO es Lemon
    let stored: SiweNonce | null = null;

    if (!isLemon) {
      stored = await this.nonceRepo.findOne({
        where: {
          nonce: nonceFromMessage,
          used: false,
          expiresAt: MoreThan(now),
        },
      });

      if (!stored) {
        this.logger.warn(
          `Nonce inválido o expirado en DB. nonceFromMessage=${nonceFromMessage}`,
        );
        throw new UnauthorizedException('Invalid or expired nonce');
      }
    } else {
      this.logger.log(
        `SIWE via Lemon (domain=${domainFromMessage}) – saltando check de nonce en DB (replay protection vía Redis)`,
      );

      // Anti-replay: check if this nonce was already used for this wallet
      const replayKey = `siwe:lemon:${nonceFromMessage}:${addressFromMessage.toLowerCase()}`;
      const alreadyUsed = await this.cacheManager.get(replayKey);
      if (alreadyUsed) {
        this.logger.warn(
          `Lemon replay detected nonce=${nonceFromMessage} wallet=${addressFromMessage.slice(0, 8)}…`,
        );
        throw new UnauthorizedException('Nonce already used');
      }
    }

    // 3) Crear un publicClient con la chain del mensaje (RPC real)
    const chainConfig = this.getChainConfig(chainIdFromMessage);
    const rpcUrl: string =
      chainConfig.rpcUrls?.default?.http?.[0] ?? 'https://mainnet.base.org';

    const publicClient = createPublicClient({
      chain: chainConfig,
      transport: http(rpcUrl),
    });

    // 4) Verificar firma SIWE (soporta ERC-6492) + logs de debug
    let isValid = false;

    const sigLen = signature?.length ?? 0;
    const isHex = typeof signature === 'string' && signature.startsWith('0x');
    const isPlainEcdsa = isHex && sigLen === 132; // 0x + 130 chars (65 bytes)
    const looksLike6492Envelope = isHex && sigLen > 132; // firma "larga" tipo smart wallet

    this.logger.log(
      `SIWE signature debug: len=${sigLen} plainEcdsa=${isPlainEcdsa} looks6492=${looksLike6492Envelope} first12=${signature?.slice(
        0,
        12,
      )}...`,
    );

    try {
      this.logger.log(
        `Verifying SIWE via publicClient.verifySiweMessage for addressFromMessage=${addressFromMessage} chainId=${chainConfig.id}`,
      );

      isValid = await publicClient.verifySiweMessage({
        message,
        signature: signature as `0x${string}`,
        address: addressFromMessage as `0x${string}`,
      });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`SIWE verification exception: ${errMessage}`);
      // seguimos con posibles fallbacks
    }

    // --- Fallback ECDSA crudo SOLO si la firma es una ECDSA clásica ---
    if (!isValid && isPlainEcdsa) {
      try {
        const recovered = await recoverMessageAddress({
          message,
          signature: signature as `0x${string}`,
        });

        const recoveredLower = recovered.toLowerCase();
        const expectedLower = addressFromMessage;

        this.logger.warn(
          `Fallback recoverMessageAddress: recovered=${recoveredLower} expected=${expectedLower} domain=${domainFromMessage}`,
        );

        if (recoveredLower === expectedLower) {
          this.logger.log(
            `Fallback recoverMessageAddress OK – firma ECDSA válida para el mensaje (verifySiweMessage devolvió false).`,
          );
          isValid = true;
        }
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Fallback recoverMessageAddress exception (ECDSA): ${errMessage}`,
        );
      }
    } else if (!isValid && looksLike6492Envelope) {
      // Firma larga tipo ERC-6492 (smart wallet / counterfactual).
      // Solo Lemon usa smart wallets con ERC-6492.
      const trusted6492Domain = isLemon;

      if (trusted6492Domain) {
        // Validate message freshness — reject messages older than 5 minutes
        const issuedAt = parsed.issuedAt ? new Date(parsed.issuedAt) : null;
        const MAX_AGE_MS = 5 * 60 * 1000;

        if (!issuedAt || now.getTime() - issuedAt.getTime() > MAX_AGE_MS) {
          this.logger.warn(
            `ERC-6492 message too old or missing issuedAt for ${addressFromMessage.slice(0, 8)}…`,
          );
          throw new UnauthorizedException('Message expired');
        }

        // Cryptographic ERC-6492 verification via viem's verifyMessage.
        // verifyMessage supports ERC-6492 envelopes via deployless calls and
        // will return true only if the signature is cryptographically valid
        // for the smart wallet at addressFromMessage.
        try {
          const erc6492Valid = await publicClient.verifyMessage({
            address: addressFromMessage as `0x${string}`,
            message,
            signature: signature as `0x${string}`,
          });

          if (erc6492Valid) {
            isValid = true;
            this.logger.log(
              `ERC-6492 cryptographically verified for Lemon domain=${domainFromMessage} wallet=${addressFromMessage.slice(0, 8)}…`,
            );
          } else {
            this.logger.warn(
              `ERC-6492 signature INVALID for Lemon domain=${domainFromMessage} wallet=${addressFromMessage.slice(0, 8)}…`,
            );
          }
        } catch (err: unknown) {
          const errMessage = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `ERC-6492 verifyMessage exception for ${addressFromMessage.slice(0, 8)}…: ${errMessage}`,
          );
        }
      } else {
        this.logger.warn(
          `Firma larga (posible 6492) pero dominio no está en la lista de confianza (${domainFromMessage}); no se aplica override.`,
        );
      }
    }

    if (!isValid) {
      this.logger.warn(
        `SIWE verification returned false. body.wallet=${wallet} msg.address=${addressFromMessage} domain=${domainFromMessage}`,
      );
      throw new UnauthorizedException('Invalid SIWE signature');
    }

    this.logger.log(
      `SIWE verification OK for address=${addressFromMessage} nonce=${nonceFromMessage} chainId=${chainConfig.id} domain=${domainFromMessage}`,
    );

    // 5) Marcar nonce como usado:
    //    - Si NO es Lemon: usamos el que ya habíamos traído (stored).
    //    - Si es Lemon: buscamos por nonce y lo marcamos used si existe.
    if (!isLemon && stored) {
      stored.used = true;
      await this.nonceRepo.save(stored);
      this.logger.log(`Nonce marked as used nonce=${nonceFromMessage}`);
    } else if (isLemon) {
      try {
        const lemonNonce = await this.nonceRepo.findOne({
          where: { nonce: nonceFromMessage },
        });
        if (lemonNonce && !lemonNonce.used) {
          lemonNonce.used = true;
          await this.nonceRepo.save(lemonNonce);
          this.logger.log(
            `Nonce (Lemon) marked as used nonce=${nonceFromMessage}`,
          );
        } else if (!lemonNonce) {
          this.logger.log(
            `Nonce (Lemon) no encontrado en DB para marcar como usado nonce=${nonceFromMessage}`,
          );
        }
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Error marcando nonce Lemon como usado: ${errMessage}`,
        );
      }

      // Mark nonce as used in Redis to prevent replay attacks
      const replayKey = `siwe:lemon:${nonceFromMessage}:${addressFromMessage.toLowerCase()}`;
      await this.cacheManager.set(replayKey, true, 10 * 60 * 1000); // 10 min TTL
      this.logger.log(
        `Lemon nonce marked as used in Redis nonce=${nonceFromMessage} wallet=${addressFromMessage.slice(0, 8)}…`,
      );
    }

    // 6) Crear access token para la address del mensaje
    const accessToken = await this.createAccessToken(addressFromMessage);
    this.logger.log(
      `AccessToken created for wallet=${addressFromMessage} token=${accessToken.slice(
        0,
        6,
      )}...`,
    );

    return { wallet: addressFromMessage, accessToken };
  }

  async verifyStellarAndIssueToken(input: {
    wallet: string;
    signature: string;
    message: string;
    nonce: string;
  }): Promise<{ wallet: string; accessToken: string }> {
    const { signature, message, nonce } = input;
    const wallet = normalizeWallet(input.wallet);
    const now = new Date();

    this.logger.log(
      `verifyStellarAndIssueToken IN wallet=${wallet} nonce=${nonce} at=${now.toISOString()}`,
    );

    const stored = await this.nonceRepo.findOne({
      where: {
        nonce,
        used: false,
        expiresAt: MoreThan(now),
      },
    });

    if (!stored) {
      this.logger.warn(`Invalid or expired Stellar nonce=${nonce}`);
      throw new UnauthorizedException('Invalid or expired nonce');
    }

    let messageBytes: Buffer;
    let signatureBytes: Buffer;
    try {
      // The frontend signs the plain UTF-8 auth message (buildStellarAuthMessage)
      // and sends it as-is, so decode it as utf8 — NOT base64. These are the exact
      // bytes Freighter signed per SEP-53; base64-decoding a plain string yields
      // garbage and breaks both the nonce check and signature verification.
      messageBytes = Buffer.from(message, 'utf8');
      signatureBytes = Buffer.from(signature, 'base64');
    } catch {
      throw new UnauthorizedException('Invalid Stellar signature payload');
    }

    const decodedMessage = messageBytes.toString('utf8');
    if (!decodedMessage.includes(nonce)) {
      this.logger.warn(`Stellar signed message missing nonce=${nonce}`);
      throw new UnauthorizedException('Signed message nonce mismatch');
    }

    let isValid = false;
    try {
      const { verifyAsync: verifyEd25519 } = (await import(
        '@noble/ed25519'
      )) as typeof import('@noble/ed25519');
      const sep53MessageHash = createHash('sha256')
        .update('Stellar Signed Message:\n', 'utf8')
        .update(messageBytes)
        .digest();
      isValid = await verifyEd25519(
        signatureBytes,
        sep53MessageHash,
        decodeStellarPublicKey(wallet),
      );
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Stellar signature verification exception wallet=${wallet}: ${errMessage}`,
      );
    }

    if (!isValid) {
      throw new UnauthorizedException('Invalid Stellar signature');
    }

    stored.used = true;
    await this.nonceRepo.save(stored);

    const accessToken = await this.createAccessToken(wallet);
    this.logger.log(
      `Stellar auth OK wallet=${wallet} token=${accessToken.slice(0, 6)}...`,
    );

    return { wallet, accessToken };
  }

  // =========== ACCESS TOKEN ===========

  private async createAccessToken(wallet: string): Promise<string> {
    const token = randomBytes(24).toString('hex'); // 48 chars
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    const walletAddress = normalizeWallet(wallet);

    const entity = this.tokenRepo.create({
      token,
      walletAddress,
      expiresAt,
    });

    await this.tokenRepo.save(entity);

    this.logger.log(
      `AccessToken persisted wallet=${walletAddress} token=${token.slice(
        0,
        6,
      )}... expiresAt=${expiresAt.toISOString()}`,
    );

    return token;
  }

  // =========== REFRESH TOKEN ===========

  async refreshToken(
    currentToken: string,
  ): Promise<{ accessToken: string; wallet: string }> {
    const preview = currentToken ? currentToken.slice(0, 6) : 'EMPTY';
    this.logger.log(`refreshToken called token=${preview}...`);

    const record = await this.tokenRepo.findOne({
      where: { token: currentToken },
    });

    if (!record) {
      throw new UnauthorizedException('Invalid token');
    }

    if (record.revokedAt) {
      throw new UnauthorizedException('Token revoked');
    }

    // Allow refresh up to 15 minutes after expiry (grace window)
    const graceMs = 15 * 60 * 1000;
    if (record.expiresAt && record.expiresAt.getTime() + graceMs < Date.now()) {
      throw new UnauthorizedException('Token expired beyond refresh window');
    }

    // Atomically revoke old token (prevents concurrent refresh from issuing multiple tokens)
    const result = await this.tokenRepo
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where('id = :id', { id: record.id })
      .andWhere('revokedAt IS NULL')
      .execute();

    if (!result.affected) {
      throw new UnauthorizedException('Token already revoked');
    }

    // Immediately evict the revoked token from cache so it cannot be reused
    await this.cacheManager.del(`token:${currentToken}`);
    this.logger.log(`Cache entry evicted for revoked token=${preview}...`);

    // Issue new token
    const newToken = await this.createAccessToken(record.walletAddress);
    this.logger.log(`Token refreshed for wallet=${record.walletAddress}`);

    return { accessToken: newToken, wallet: record.walletAddress };
  }

  // =========== VALIDACIÓN DE TOKEN (para el guard) ===========

  async validateToken(token: string): Promise<{ walletAddress: string }> {
    const now = new Date();
    const preview = token ? token.slice(0, 6) : 'EMPTY';
    const cacheKey = `token:${token}`;

    this.logger.log(`validateToken called token=${preview}...`);

    // Check in-memory cache first — skips DB on cache hit
    const cached = await this.cacheManager.get<TokenCacheEntry>(cacheKey);
    if (cached) {
      this.logger.log(
        `validateToken cache hit token=${preview}... wallet=${cached.walletAddress}`,
      );
      return { walletAddress: cached.walletAddress };
    }

    // Cache miss — fall through to DB
    const record = await this.tokenRepo.findOne({ where: { token } });

    if (!record) {
      this.logger.warn(`Token not found in DB token=${preview}...`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (record.expiresAt && record.expiresAt < now) {
      this.logger.warn(
        `Token expired token=${preview}... expiresAt=${record.expiresAt.toISOString()}`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (record.revokedAt) {
      this.logger.warn(
        `Token revoked token=${preview}... revokedAt=${record.revokedAt.toISOString()}`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }

    this.logger.log(`Token valid for wallet=${record.walletAddress}`);

    // Populate cache with explicit TTL so entry NEVER outlives the token.
    // Use min(expiresAt - now, 10s) — capped short to close revocation race window.
    const remainingMs = record.expiresAt
      ? Math.max(0, record.expiresAt.getTime() - now.getTime())
      : 10_000;
    const cacheTtlMs = Math.min(remainingMs, 10_000);
    await this.cacheManager.set(
      cacheKey,
      { walletAddress: record.walletAddress },
      cacheTtlMs,
    );
    this.logger.log(
      `validateToken cached token=${preview}... wallet=${record.walletAddress} ttl=${cacheTtlMs}ms`,
    );

    return { walletAddress: record.walletAddress };
  }

  // =========== CLEANUP EXPIRED NONCES & TOKENS ===========

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredAuth() {
    const now = new Date();

    const deletedNonces = await this.nonceRepo.delete({
      expiresAt: LessThan(now),
    });

    // Delete tokens expired beyond the 15-min refresh grace window, plus all revoked tokens
    const graceMs = 15 * 60 * 1000;
    const cutoff = new Date(Date.now() - graceMs);
    const deletedTokens = await this.tokenRepo
      .createQueryBuilder()
      .delete()
      .where('expiresAt < :cutoff', { cutoff })
      .orWhere('revokedAt IS NOT NULL')
      .execute();

    this.logger.log(
      `Auth cleanup: removed ${deletedNonces.affected ?? 0} nonces, ${deletedTokens.affected ?? 0} tokens`,
    );
  }
}
