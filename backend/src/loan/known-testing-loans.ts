/**
 * Spec 070 — known pre-launch testing loans.
 *
 * 29 LoanOpened events on chain from contract smoke-testing between
 * 2025-11-22 and 2025-12-09, BEFORE the production launch. All are
 * $1-$3 principal, all CLOSED or DEFAULTED, all from test wallets
 * controlled by the team (admin wallets + early ops accounts).
 *
 * These loans are intentionally NOT in the production DB and never
 * will be — they were never real credit exposure. We list them here
 * so the DB↔chain parity metric can subtract them out and report the
 * *effective* drift (i.e. drift caused by real bugs/timing, not by
 * historical contract testing noise).
 *
 * 🚨 This list is FROZEN. Do not add new entries — the underlying
 * dates are pre-launch and immutable on chain. If parity shows new
 * drift, that is a real signal, not "more testing loans appeared".
 */
export const KNOWN_TESTING_LOAN_TXHASHES: ReadonlySet<string> = new Set([
  '0x6b45fabf6abd840e4185b46b3132d7755ed62100a1899a5cbce28d7639afb1d5', // 2025-11-22 $2
  '0x6d1edaaff7c10d4fd8065a27e3f0119491c1e7e014e4e0bfc0a404860e41cd9d', // 2025-11-22 $2
  '0xe515a02ee02afbd9cdda5d4be96840bac11b11f2ea8152b79f2204894db95114', // 2025-11-28 $3
  '0x24e52d2acc3443ad957d4003e5bb328d4f58eef27ca41bd1758ccc6f0bc7869c', // 2025-11-29 $1
  '0x2a4d6d13f95bf1e0a675b17fe9ea1a22211dda679cfbbc1ad32ccdaf57527926', // 2025-11-30 $1
  '0x5b86de179099fe13a259837d4f700dba8e16b18c7d574bfd2b91d91d2410876a', // 2025-11-30 $1
  '0xa09e7e9ac2703b8152735a172b57cc98492db0973e6756ff7064ed7b3044534a', // 2025-11-30 $1
  '0xe11e82ab0fe9381d655cd672445cd9b9ded8a7c882b93704ef331b802019c6c1', // 2025-11-30 $1
  '0xe409d4c249943b8e9fe13feec50eeb48174acc1c167d493e5e34a55dcad4deb4', // 2025-11-30 $1
  '0x59b0e9dac61a802dbb97f85a0f37bff856a0c4bade53e8954ac53cb74d5a2eba', // 2025-11-30 $1
  '0xdc6f02d933a5582eed43b46853951f9e06120d60ed882efad9be56d62b2f2d4b', // 2025-11-30 $1
  '0xf760a8848e61a225375c2fa43a67dd1d613e45f3b1055a38d5029d6fbc9d7cfc', // 2025-12-01 $1
  '0xb533057cd5c8801b00a005ae4d56b3bf4bdd6d891608493b255b379a6313584a', // 2025-12-01 $1
  '0x70784730c5b3168b475e3a3e69bbebbad8023e5c11a1fb81bbc932cbe7350c4f', // 2025-12-01 $1
  '0x7e42bc941011d645b6b820fff198248c5f5cebae3a2861a1eb8c3ccc752e1097', // 2025-12-01 $1
  '0x4b52a774207a7295bfa8dc282c158f2a62248c1659de98861ddbd00bbf71e742', // 2025-12-01 $1
  '0x3525acde431ed42f4d5b843050ac50142ebe0d0947da805b41454723edd4a3c9', // 2025-12-02 $1
  '0x455f1d6e860600d2596f35639c813165e637f51192cf54cb5fe06c4fad75fcce', // 2025-12-02 $1
  '0x8077a5c6eea0b50fe2ca883d243a7113e0ca12a828689f9cefcca0d913b03af0', // 2025-12-03 $1
  '0x7337a698d2651495f1bb3621f53dffc906e3ed6f32c3e691653bf8010d110896', // 2025-12-03 $1
  '0xa1a617a413740eca9ca2afdd406f29be0b9deae8df8a02351b84a5f9e548ea3f', // 2025-12-03 $1
  '0x4b2ca615ef992e78aa485e6e6bd9cfdc0be22f4bd7aba04924ead7bc8f0e5ec9', // 2025-12-08 $1
  '0xee119c7f6dab82bf649c54d728a65471d2b1a394bb04b2de8fa67944b03b0dcf', // 2025-12-08 $1
  '0x69660574baf49c2aea2f83521c5f23bff66d81fa0d5f514188f9fc3090e9fd63', // 2025-12-08 $1
  '0x32a1c749c238819b18ccf50583d5b6bf94012eb839817b961bf19cb8b1ac3b14', // 2025-12-08 $1
  '0x1bcd7d36552b1099a413cdd82b7080f708da0332df79408e43818777f334032c', // 2025-12-08 $1
  '0xbaafc1024e200117d48aa1377906b7c9f06e340db11a25f9768e5bed8f0a68bc', // 2025-12-08 $2
  '0x0fea7be55e95f190d29fc85646e18da4c73bf1cf83d65d97440c67fe89a7a38e', // 2025-12-09 $1
  '0x4dc0dcae5fe9c8191d5d933e4f7a7ad25b5c4afdf62a8a3293eb9fbe72805afb', // 2025-12-09 $1
]);

/**
 * Count of known-testing loans expected to exist on chain but NOT in DB.
 * Subtract this from raw `subgraph_count − db_count` to get effective drift.
 */
export const KNOWN_TESTING_LOANS_COUNT = KNOWN_TESTING_LOAN_TXHASHES.size;
