/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/bursar_solana.json`.
 */
export type BursarSolana = {
  "address": "F8hK6X1HjNsroUDio4QujwReNpaEFuabyPhMDEXBnjVe",
  "metadata": {
    "name": "bursarSolana",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Bursar on Solana: spending rules for teams and their AI agents"
  },
  "instructions": [
    {
      "name": "addSpender",
      "docs": [
        "Grants a person or an agent a policy. A revoked spender can be granted again, with a new",
        "generation, so nothing it filed before the revoke can settle."
      ],
      "discriminator": [
        124,
        73,
        160,
        154,
        78,
        211,
        227,
        177
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "team",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  97,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "spender",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "team"
              },
              {
                "kind": "arg",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "kind",
          "type": {
            "defined": {
              "name": "kind"
            }
          }
        },
        {
          "name": "label",
          "type": "string"
        },
        {
          "name": "policy",
          "type": {
            "defined": {
              "name": "policy"
            }
          }
        },
        {
          "name": "services",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "approve",
      "docs": [
        "The owner approves a pending payment and it settles in the same transaction.",
        "A stop that applies now (revoked, expired, service suspended or moved) refuses it for good."
      ],
      "discriminator": [
        69,
        74,
        217,
        36,
        115,
        117,
        97,
        76
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "team",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  97,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          },
          "relations": [
            "spender",
            "payment"
          ]
        },
        {
          "name": "spender",
          "writable": true
        },
        {
          "name": "service"
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "payeeToken",
          "writable": true
        },
        {
          "name": "payment",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "cancel",
      "docs": [
        "The owner, or the spender who filed it, withdraws a pending payment."
      ],
      "discriminator": [
        232,
        219,
        223,
        41,
        219,
        236,
        220,
        190
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "team",
          "relations": [
            "payment"
          ]
        },
        {
          "name": "payment",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "createTeam",
      "discriminator": [
        122,
        161,
        98,
        67,
        178,
        128,
        116,
        113
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Pays the rent for the team and its vault. Can be a sponsor."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "team",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  97,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "team"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        }
      ]
    },
    {
      "name": "decline",
      "discriminator": [
        24,
        57,
        90,
        162,
        91,
        94,
        245,
        177
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "team",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  97,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          },
          "relations": [
            "payment"
          ]
        },
        {
          "name": "payment",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "initConfig",
      "docs": [
        "One registry per deployment: who may list services, and which token teams hold."
      ],
      "discriminator": [
        23,
        235,
        115,
        232,
        168,
        96,
        1,
        231
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "pay",
      "docs": [
        "Pays a registered service from the vault under the signer's policy.",
        "",
        "`payer` covers the fee and the payment record's rent, so the spender never needs SOL.",
        "The payment record's address is derived from (spender, intent), so one intent can be",
        "paid or filed at most once."
      ],
      "discriminator": [
        119,
        18,
        216,
        65,
        192,
        117,
        122,
        220
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Pays the fee and the payment record's rent. A sponsor, so spenders never hold SOL."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "docs": [
            "The person or agent paying. Holds no money of its own."
          ],
          "signer": true,
          "relations": [
            "spender"
          ]
        },
        {
          "name": "team",
          "writable": true,
          "relations": [
            "spender"
          ]
        },
        {
          "name": "spender",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "team"
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "service",
          "docs": [
            "The registry entry. An unknown service id has no account, so the call fails here."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  114,
                  118,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "service.id",
                "account": "service"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "payeeToken",
          "docs": [
            "Must be the payee the registry names. A made-up recipient cannot be passed."
          ],
          "writable": true
        },
        {
          "name": "payment",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "spender"
              },
              {
                "kind": "arg",
                "path": "intent"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "intent",
          "type": "string"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "memo",
          "type": "string"
        }
      ]
    },
    {
      "name": "registerService",
      "docs": [
        "Lists a service a team can pay. `price` is the list price shown to agents; it is not a limit."
      ],
      "discriminator": [
        11,
        133,
        158,
        232,
        193,
        19,
        229,
        73
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "service",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  114,
                  118,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "payeeToken"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "string"
        },
        {
          "name": "label",
          "type": "string"
        },
        {
          "name": "price",
          "type": "u64"
        }
      ]
    },
    {
      "name": "revoke",
      "discriminator": [
        170,
        23,
        31,
        34,
        133,
        173,
        93,
        242
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "team",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  97,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          },
          "relations": [
            "spender"
          ]
        },
        {
          "name": "spender",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "team"
              },
              {
                "kind": "account",
                "path": "spender.authority",
                "account": "spender"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "team",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  97,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setPolicy",
      "discriminator": [
        40,
        133,
        12,
        157,
        235,
        202,
        2,
        132
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "team",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  97,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          },
          "relations": [
            "spender"
          ]
        },
        {
          "name": "spender",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "team"
              },
              {
                "kind": "account",
                "path": "spender.authority",
                "account": "spender"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "policy",
          "type": {
            "defined": {
              "name": "policy"
            }
          }
        }
      ]
    },
    {
      "name": "setServiceActive",
      "docs": [
        "Suspends or restores a service. A suspended service cannot be paid or settled."
      ],
      "discriminator": [
        221,
        172,
        149,
        49,
        212,
        184,
        77,
        101
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "service",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  114,
                  118,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "service.id",
                "account": "service"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setServices",
      "discriminator": [
        179,
        40,
        158,
        232,
        75,
        174,
        228,
        252
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "team",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  97,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          },
          "relations": [
            "spender"
          ]
        },
        {
          "name": "spender",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "team"
              },
              {
                "kind": "account",
                "path": "spender.authority",
                "account": "spender"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "services",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "setSpenderStatus",
      "docs": [
        "Pauses or resumes a spender. Revoking is its own call because it cannot be undone."
      ],
      "discriminator": [
        160,
        201,
        124,
        196,
        87,
        121,
        118,
        241
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "team",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  97,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          },
          "relations": [
            "spender"
          ]
        },
        {
          "name": "spender",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "team"
              },
              {
                "kind": "account",
                "path": "spender.authority",
                "account": "spender"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Moves money out of the vault to an account the owner names. Only the owner can."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "team",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  101,
                  97,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "team"
          ]
        },
        {
          "name": "to",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "payment",
      "discriminator": [
        227,
        231,
        51,
        26,
        244,
        88,
        4,
        148
      ]
    },
    {
      "name": "service",
      "discriminator": [
        144,
        62,
        76,
        129,
        167,
        36,
        151,
        250
      ]
    },
    {
      "name": "spender",
      "discriminator": [
        157,
        194,
        95,
        95,
        55,
        132,
        208,
        151
      ]
    },
    {
      "name": "team",
      "discriminator": [
        140,
        218,
        177,
        140,
        193,
        241,
        199,
        106
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "teamPaused",
      "msg": "the team is paused"
    },
    {
      "code": 6001,
      "name": "notActive",
      "msg": "spender is not active"
    },
    {
      "code": 6002,
      "name": "expired",
      "msg": "spender policy has expired"
    },
    {
      "code": 6003,
      "name": "serviceSuspended",
      "msg": "the service is suspended"
    },
    {
      "code": 6004,
      "name": "wrongPayee",
      "msg": "the payee is not the one the registry names"
    },
    {
      "code": 6005,
      "name": "notPending",
      "msg": "payment is not pending"
    },
    {
      "code": 6006,
      "name": "requestExpired",
      "msg": "the pending payment has expired"
    },
    {
      "code": 6007,
      "name": "notOwnerOrFiler",
      "msg": "only the owner or the filer can cancel"
    },
    {
      "code": 6008,
      "name": "alreadySpender",
      "msg": "already a spender: change its policy instead"
    },
    {
      "code": 6009,
      "name": "kindChanged",
      "msg": "a spender keeps its kind"
    },
    {
      "code": 6010,
      "name": "zeroAmount",
      "msg": "amount must be above zero"
    },
    {
      "code": 6011,
      "name": "memoTooLong",
      "msg": "a memo is at most 64 bytes"
    },
    {
      "code": 6012,
      "name": "badIntent",
      "msg": "an intent is 1 to 32 characters of a-z, A-Z, 0-9, - and _"
    },
    {
      "code": 6013,
      "name": "badServiceId",
      "msg": "a service id is 1 to 32 characters of a-z, 0-9 and -"
    },
    {
      "code": 6014,
      "name": "badLabel",
      "msg": "a label is 1 to 32 characters"
    },
    {
      "code": 6015,
      "name": "badPolicy",
      "msg": "allowance and cap above zero, cap within allowance, period at least 60 s, at least 1 payment, expiry in the future"
    },
    {
      "code": 6016,
      "name": "tooManyServices",
      "msg": "at most 8 services per spender"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "services",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "kind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "person"
          },
          {
            "name": "agent"
          }
        ]
      }
    },
    {
      "name": "payment",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "team",
            "type": "pubkey"
          },
          {
            "name": "spender",
            "docs": [
              "The spender account (PDA)."
            ],
            "type": "pubkey"
          },
          {
            "name": "authority",
            "docs": [
              "The key that signed `pay`."
            ],
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "kind"
              }
            }
          },
          {
            "name": "service",
            "type": "pubkey"
          },
          {
            "name": "payeeToken",
            "docs": [
              "The payee the registry named when the payment was filed. Only this account can be paid."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "intent",
            "type": "string"
          },
          {
            "name": "memo",
            "type": "string"
          },
          {
            "name": "generation",
            "type": "u32"
          },
          {
            "name": "reasons",
            "type": "u8"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "paymentStatus"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "deadline",
            "docs": [
              "Pending payments can be approved until this time. Zero when paid at once."
            ],
            "type": "i64"
          },
          {
            "name": "decidedAt",
            "type": "i64"
          },
          {
            "name": "number",
            "docs": [
              "Order within the team, from zero."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "paymentStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "paid"
          },
          {
            "name": "pending"
          },
          {
            "name": "settled"
          },
          {
            "name": "declined"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "refused"
          }
        ]
      }
    },
    {
      "name": "policy",
      "docs": [
        "Amounts are token base units (USDC has 6 decimals). Times are unix seconds."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "allowance",
            "docs": [
              "What the spender may pay in one period."
            ],
            "type": "u64"
          },
          {
            "name": "periodSecs",
            "type": "u32"
          },
          {
            "name": "cap",
            "docs": [
              "The most one payment may be."
            ],
            "type": "u64"
          },
          {
            "name": "maxPayments",
            "docs": [
              "The most payments in one period."
            ],
            "type": "u32"
          },
          {
            "name": "expiresAt",
            "docs": [
              "The policy refuses from this instant on."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "service",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "string"
          },
          {
            "name": "label",
            "type": "string"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "payeeToken",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "spender",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "team",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "kind"
              }
            }
          },
          {
            "name": "label",
            "type": "string"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "status"
              }
            }
          },
          {
            "name": "generation",
            "type": "u32"
          },
          {
            "name": "policy",
            "type": {
              "defined": {
                "name": "policy"
              }
            }
          },
          {
            "name": "services",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "periodStart",
            "type": "i64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "count",
            "type": "u32"
          },
          {
            "name": "addedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "status",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "paused"
          },
          {
            "name": "revoked"
          }
        ]
      }
    },
    {
      "name": "team",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "spenders",
            "type": "u32"
          },
          {
            "name": "payments",
            "type": "u64"
          },
          {
            "name": "paidCount",
            "type": "u64"
          },
          {
            "name": "paidTotal",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
